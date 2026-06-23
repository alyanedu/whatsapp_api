import path from 'node:path';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

import { config } from './config.js';
import { baileysLogger, logger } from './logger.js';
import { ensureDir, readJson, writeJson } from './utils/files.js';

export class SessionManager {
  constructor() {
    this.sessionsFile = path.join(config.dataDir, 'sessions.json');
    this.sessions = new Map();
  }

  async init() {
    await ensureDir(config.sessionsDir);
    await ensureDir(config.dataDir);
    const savedSessions = await readJson(this.sessionsFile, []);
    for (const saved of savedSessions) {
      this.sessions.set(saved.id, this.#createState(saved));
    }
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map((session) => this.#publicSession(session));
  }

  get(id) {
    const session = this.sessions.get(id);
    return session ? this.#publicSession(session) : null;
  }

  async create({ id, label, priority = 100, enabled = true }) {
    if (!/^[a-zA-Z0-9_-]{2,40}$/.test(id)) {
      throw new Error('Session id must use letters, numbers, underscore, or dash.');
    }
    if (this.sessions.has(id)) throw new Error(`Session ${id} already exists.`);
    const state = this.#createState({ id, label, priority, enabled });
    this.sessions.set(id, state);
    await this.#saveSessionConfigs();
    return this.#publicSession(state);
  }

  async update(id, patch) {
    const session = this.#requireSession(id);
    if (patch.label != null) session.label = String(patch.label);
    if (patch.priority != null) session.priority = Number(patch.priority);
    if (patch.enabled != null) session.enabled = Boolean(patch.enabled);
    await this.#saveSessionConfigs();
    return this.#publicSession(session);
  }

  async start(id) {
    const session = this.#requireSession(id);
    if (session.socket || session.starting) return this.#publicSession(session);

    session.starting = true;
    session.status = 'starting';
    session.lastError = null;

    try {
      const sessionPath = path.join(config.sessionsDir, id);
      await ensureDir(sessionPath);
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version } = await fetchLatestBaileysVersion();
      const socket = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        logger: baileysLogger,
        browser: ['TimberHub OTP Gateway', 'Chrome', '1.0.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });

      session.socket = socket;
      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', (update) => this.#onConnectionUpdate(session, update));
      return this.#publicSession(session);
    } catch (error) {
      session.status = 'error';
      session.lastError = error.message;
      throw error;
    } finally {
      session.starting = false;
    }
  }

  async startAll() {
    const results = [];
    for (const session of this.sessions.values()) {
      if (!session.enabled) continue;
      try {
        results.push(await this.start(session.id));
      } catch (error) {
        logger.warn({ sessionId: session.id, error: error.message }, 'Failed to start session');
      }
    }
    return results;
  }

  async logout(id) {
    const session = this.#requireSession(id);
    if (session.socket) {
      await session.socket.logout();
      session.socket = null;
    }
    session.status = 'logged_out';
    session.qr = null;
    return this.#publicSession(session);
  }

  async getQr(id) {
    const session = this.#requireSession(id);
    if (!session.qr) return null;
    return {
      qr: session.qr,
      dataUrl: await QRCode.toDataURL(session.qr),
    };
  }

  async getQrPng(id) {
    const session = this.#requireSession(id);
    if (!session.qr) return null;
    return QRCode.toBuffer(session.qr, {
      type: 'png',
      width: 420,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
  }

  async sendWithFailover({ jid, text }) {
    const candidates = [...this.sessions.values()]
      .filter((session) => session.enabled && session.status === 'connected' && !this.#isPaused(session))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

    if (candidates.length === 0) {
      throw new Error('No connected WhatsApp sessions are available.');
    }

    const errors = [];
    for (const session of candidates) {
      try {
        const result = await session.socket.sendMessage(jid, { text });
        session.failureCount = 0;
        session.lastSentAt = new Date().toISOString();
        return { sessionId: session.id, messageId: result?.key?.id || null };
      } catch (error) {
        this.#recordFailure(session, error);
        errors.push(`${session.id}: ${error.message}`);
        if (!config.sessionFailover) break;
      }
    }

    throw new Error(`All WhatsApp sessions failed: ${errors.join('; ')}`);
  }

  #createState(saved) {
    return {
      id: saved.id,
      label: saved.label || saved.id,
      priority: Number(saved.priority ?? 100),
      enabled: saved.enabled !== false,
      status: 'stopped',
      phone: saved.phone || null,
      qr: null,
      socket: null,
      starting: false,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastSentAt: null,
      lastError: null,
      failureCount: 0,
      pausedUntil: null,
    };
  }

  #onConnectionUpdate(session, update) {
    if (update.qr) {
      session.qr = update.qr;
      session.status = 'qr';
      logger.info({ sessionId: session.id }, 'QR code generated for WhatsApp session');
    }

    if (update.connection === 'open') {
      session.status = 'connected';
      session.qr = null;
      session.lastConnectedAt = new Date().toISOString();
      session.phone = session.socket?.user?.id || session.phone;
      logger.info({ sessionId: session.id, phone: session.phone }, 'WhatsApp session connected');
      void this.#saveSessionConfigs();
    }

    if (update.connection === 'close') {
      session.socket = null;
      session.qr = null;
      session.lastDisconnectedAt = new Date().toISOString();
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      session.status = loggedOut ? 'logged_out' : 'disconnected';
      session.lastError = update.lastDisconnect?.error?.message || null;
      logger.warn({ sessionId: session.id, loggedOut, statusCode }, 'WhatsApp session closed');

      if (!loggedOut && session.enabled) {
        setTimeout(() => {
          this.start(session.id).catch((error) => {
            logger.warn({ sessionId: session.id, error: error.message }, 'Reconnect failed');
          });
        }, 5000);
      }
    }
  }

  #recordFailure(session, error) {
    session.failureCount += 1;
    session.lastError = error.message;
    if (session.failureCount >= config.sessionFailureLimit) {
      session.pausedUntil = new Date(Date.now() + config.sessionPauseSeconds * 1000).toISOString();
      logger.warn({ sessionId: session.id, pausedUntil: session.pausedUntil }, 'Session paused after repeated failures');
    }
  }

  #isPaused(session) {
    return session.pausedUntil && new Date(session.pausedUntil).getTime() > Date.now();
  }

  #publicSession(session) {
    return {
      id: session.id,
      label: session.label,
      priority: session.priority,
      enabled: session.enabled,
      status: session.status,
      phone: session.phone,
      hasQr: Boolean(session.qr),
      lastConnectedAt: session.lastConnectedAt,
      lastDisconnectedAt: session.lastDisconnectedAt,
      lastSentAt: session.lastSentAt,
      lastError: session.lastError,
      failureCount: session.failureCount,
      pausedUntil: session.pausedUntil,
    };
  }

  #requireSession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} was not found.`);
    return session;
  }

  async #saveSessionConfigs() {
    const saved = [...this.sessions.values()]
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map((session) => ({
        id: session.id,
        label: session.label,
        priority: session.priority,
        enabled: session.enabled,
        phone: session.phone,
      }));
    await writeJson(this.sessionsFile, saved);
  }
}