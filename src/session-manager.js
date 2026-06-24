import path from 'node:path';
import fs from 'node:fs/promises';
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
    this.routeCursors = new Map();
    this.pendingAcks = new Map();
    this.recentAcks = new Map();
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

  async start(id, options = {}) {
    const resetReconnect = options.resetReconnect !== false;
    const session = this.#requireSession(id);
    if (session.socket || session.starting) return this.#publicSession(session);

    if (resetReconnect) {
      this.#clearReconnectTimer(session);
      session.reconnectAttempts = 0;
      session.pausedUntil = null;
    }

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
        browser: ['WhatsApp OTP Gateway', 'Chrome', '1.0.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });

      session.socket = socket;
      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', (update) => this.#onConnectionUpdate(session, update));
      socket.ev.on('messages.update', (updates) => this.#onMessagesUpdate(session, updates));
      socket.ev.on('messaging-history.set', () => undefined);
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
      this.#clearReconnectTimer(session);
      await session.socket.logout();
      session.socket = null;
    }
    session.status = 'logged_out';
    session.qr = null;
    return this.#publicSession(session);
  }

  async delete(id, options = {}) {
    const session = this.#requireSession(id);
    await this.#closeSocket(session, options.logout === true).catch((error) => {
      logger.warn({ sessionId: id, error: error.message }, 'Socket close failed during delete');
    });
    this.sessions.delete(id);
    await fs.rm(path.join(config.sessionsDir, id), { recursive: true, force: true });
    await this.#saveSessionConfigs();
    return { id, deleted: true };
  }

  async replace(id, patch = {}) {
    const session = this.#requireSession(id);
    const next = {
      id: session.id,
      label: patch.label ?? session.label,
      priority: patch.priority ?? session.priority,
      enabled: patch.enabled ?? session.enabled,
    };
    await this.#closeSocket(session, true).catch((error) => {
      logger.warn({ sessionId: id, error: error.message }, 'Logout during replace failed; deleting local session anyway');
    });
    await fs.rm(path.join(config.sessionsDir, id), { recursive: true, force: true });
    const fresh = this.#createState(next);
    this.sessions.set(id, fresh);
    await this.#saveSessionConfigs();
    return this.start(id);
  }

  async refreshQr(id) {
    const session = this.#requireSession(id);
    if (session.status === 'connected') {
      throw new Error('Session is already connected; QR code is not available.');
    }
    if (session.status === 'logged_out') {
      await this.#resetLocalAuth(session);
    }
    if (!session.qr && !session.starting) {
      await this.start(id);
    }
    const qrSession = await this.#waitForQr(id, 10000);
    return this.#publicSession(qrSession);
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

  async getQrOrRefresh(id) {
    const session = this.#requireSession(id);
    if (!session.qr && session.status !== 'connected') {
      await this.refreshQr(id);
    }
    return this.getQr(id);
  }

  async getQrPngOrRefresh(id) {
    const session = this.#requireSession(id);
    if (!session.qr && session.status !== 'connected') {
      await this.refreshQr(id);
    }
    return this.getQrPng(id);
  }

  async sendWithFailover({ jid, text, messageType = 'message', route }) {
    const candidates = this.#selectCandidates(messageType, route);

    if (candidates.length === 0) {
      throw new Error('No connected WhatsApp sessions are available.');
    }

    const errors = [];
    for (const session of candidates) {
      try {
        const [recipient] = await session.socket.onWhatsApp(jid);
        if (!recipient?.exists) {
          throw new Error(`Recipient ${jid} is not available on WhatsApp.`);
        }
        const recipientJid = recipient.jid || jid;
        const result = await session.socket.sendMessage(recipientJid, { text });
        const messageId = result?.key?.id || null;
        const ack = await this.#waitForMessageAck(messageId, config.messageAckTimeoutSeconds * 1000);
        session.failureCount = 0;
        session.lastSentAt = new Date().toISOString();
        return { sessionId: session.id, messageId, ackStatus: ack.status, ackLabel: ack.label };
      } catch (error) {
        this.#recordFailure(session, error);
        errors.push(`${session.id}: ${error.message}`);
        if (!config.sessionFailover) break;
      }
    }

    throw new Error(`All WhatsApp sessions failed: ${errors.join('; ')}`);
  }

  #selectCandidates(messageType, route = {}) {
    const allowedSessionIds = new Set(route.sessions || []);
    const baseCandidates = [...this.sessions.values()]
      .filter((session) => session.enabled && session.status === 'connected' && !this.#isPaused(session))
      .filter((session) => allowedSessionIds.size === 0 || allowedSessionIds.has(session.id));

    const sorted = baseCandidates.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const strategy = route.strategy || 'priority';

    if (strategy === 'random') {
      return [...sorted].sort(() => Math.random() - 0.5);
    }

    if (strategy === 'sequential' && sorted.length > 1) {
      const cursorKey = `${messageType}:${route.sessions?.join(',') || '*'}`;
      const cursor = this.routeCursors.get(cursorKey) || 0;
      this.routeCursors.set(cursorKey, (cursor + 1) % sorted.length);
      return [...sorted.slice(cursor), ...sorted.slice(0, cursor)];
    }

    return sorted;
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
      reconnectAttempts: 0,
      reconnectTimer: null,
      autoReconnect: true,
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
      session.reconnectAttempts = 0;
      session.pausedUntil = null;
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
        this.#scheduleReconnect(session);
      }
    }
  }

  #onMessagesUpdate(session, updates) {
    for (const update of updates) {
      const messageId = update.key?.id;
      const status = update.update?.status;
      if (!messageId || status == null) continue;
      const label = this.#messageStatusLabel(status);
      logger.info({ sessionId: session.id, messageId, status, label }, 'WhatsApp message status update');
      this.recentAcks.set(messageId, { status, label, receivedAt: Date.now() });
      this.#pruneRecentAcks();
      const pending = this.pendingAcks.get(messageId);
      if (pending && status >= 2) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(messageId);
        pending.resolve({ status, label });
      }
    }
  }

  #waitForMessageAck(messageId, timeoutMs) {
    if (!messageId) {
      return Promise.reject(new Error('WhatsApp did not return a message id.'));
    }
    const recent = this.recentAcks.get(messageId);
    if (recent?.status >= 2) return Promise.resolve(recent);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(messageId);
        reject(new Error(`Timed out waiting for WhatsApp acknowledgement for message ${messageId}.`));
      }, timeoutMs);
      this.pendingAcks.set(messageId, { resolve, reject, timer });
    });
  }

  #pruneRecentAcks() {
    const cutoff = Date.now() - 60_000;
    for (const [messageId, ack] of this.recentAcks.entries()) {
      if (ack.receivedAt < cutoff) this.recentAcks.delete(messageId);
    }
  }

  #messageStatusLabel(status) {
    switch (status) {
      case 0:
        return 'error';
      case 1:
        return 'pending';
      case 2:
        return 'server_ack';
      case 3:
        return 'delivery_ack';
      case 4:
        return 'read';
      case 5:
        return 'played';
      default:
        return 'unknown';
    }
  }

  #scheduleReconnect(session) {
    if (session.reconnectTimer) return;
    if (session.reconnectAttempts >= config.reconnectMaxAttempts) {
      session.status = 'paused';
      session.pausedUntil = new Date(Date.now() + config.sessionPauseSeconds * 1000).toISOString();
      logger.warn(
        { sessionId: session.id, pausedUntil: session.pausedUntil },
        'Session paused after repeated reconnect failures',
      );
      return;
    }

    session.reconnectAttempts += 1;
    const delaySeconds = Math.min(
      config.reconnectMaxDelaySeconds,
      config.reconnectBaseDelaySeconds * 2 ** (session.reconnectAttempts - 1),
    );
    logger.info(
      { sessionId: session.id, attempt: session.reconnectAttempts, delaySeconds },
      'Scheduling WhatsApp session reconnect',
    );
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null;
      this.start(session.id, { resetReconnect: false }).catch((error) => {
        session.lastError = error.message;
        logger.warn({ sessionId: session.id, error: error.message }, 'Reconnect failed');
        this.#scheduleReconnect(session);
      });
    }, delaySeconds * 1000);
  }

  #clearReconnectTimer(session) {
    if (!session.reconnectTimer) return;
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }

  async #closeSocket(session, logout = false) {
    this.#clearReconnectTimer(session);
    const socket = session.socket;
    session.socket = null;
    session.qr = null;
    session.starting = false;
    if (socket && logout) await socket.logout();
    else if (socket?.end) socket.end(undefined);
  }

  async #resetLocalAuth(session) {
    await this.#closeSocket(session, false).catch((error) => {
      logger.warn({ sessionId: session.id, error: error.message }, 'Socket close failed during auth reset');
    });
    await fs.rm(path.join(config.sessionsDir, session.id), { recursive: true, force: true });
    session.status = 'stopped';
    session.qr = null;
    session.lastError = null;
    session.reconnectAttempts = 0;
    session.pausedUntil = null;
  }

  async #waitForQr(id, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const session = this.#requireSession(id);
      if (session.qr) return session;
      if (session.status === 'connected') throw new Error('Session connected before QR was generated.');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Timed out waiting for QR code. Try refresh-qr again.');
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
      reconnectAttempts: session.reconnectAttempts,
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