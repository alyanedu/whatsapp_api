import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError, z } from 'zod';

import { assertConfig, config } from './config.js';
import { logger } from './logger.js';
import { apiKeyAuth } from './middleware/api-key.js';
import { MessageLog } from './message-log.js';
import { OtpService } from './otp-service.js';
import { SessionManager } from './session-manager.js';

assertConfig();

process.on('uncaughtException', (error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Uncaught background error');
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ error: error.message, stack: error.stack }, 'Unhandled background rejection');
});

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb' }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: config.requestsPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const sessionManager = new SessionManager();
const messageLog = new MessageLog();
const otpService = new OtpService({ sessionManager, messageLog });
await sessionManager.init();

const protectedRouter = express.Router();
protectedRouter.use(apiKeyAuth(config.apiKey));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'timberhub-whatsapp-api',
    time: new Date().toISOString(),
  });
});

protectedRouter.get('/sessions', (req, res) => {
  res.json({ success: true, sessions: sessionManager.list() });
});

protectedRouter.post('/sessions', async (req, res, next) => {
  try {
    const schema = z.object({
      id: z.string().min(2).max(40),
      label: z.string().max(80).optional(),
      priority: z.number().int().optional(),
      enabled: z.boolean().optional(),
    });
    const session = await sessionManager.create(schema.parse(req.body));
    res.status(201).json({ success: true, session });
  } catch (error) {
    next(error);
  }
});

protectedRouter.patch('/sessions/:id', async (req, res, next) => {
  try {
    const schema = z.object({
      label: z.string().max(80).optional(),
      priority: z.number().int().optional(),
      enabled: z.boolean().optional(),
    });
    const session = await sessionManager.update(req.params.id, schema.parse(req.body));
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
});

protectedRouter.post('/sessions/:id/start', async (req, res, next) => {
  try {
    const session = await sessionManager.start(req.params.id);
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
});

protectedRouter.post('/sessions/start-all', async (req, res) => {
  const sessions = await sessionManager.startAll();
  res.json({ success: true, sessions });
});

protectedRouter.post('/sessions/:id/logout', async (req, res, next) => {
  try {
    const session = await sessionManager.logout(req.params.id);
    res.json({ success: true, session });
  } catch (error) {
    next(error);
  }
});

protectedRouter.get('/sessions/:id/qr', async (req, res, next) => {
  try {
    const qr = await sessionManager.getQr(req.params.id);
    if (!qr) return res.status(404).json({ success: false, error: 'QR code is not available.' });
    return res.json({ success: true, ...qr });
  } catch (error) {
    return next(error);
  }
});

protectedRouter.get('/sessions/:id/qr.png', async (req, res, next) => {
  try {
    const qrPng = await sessionManager.getQrPng(req.params.id);
    if (!qrPng) return res.status(404).json({ success: false, error: 'QR code is not available.' });
    res.type('png');
    return res.send(qrPng);
  } catch (error) {
    return next(error);
  }
});

protectedRouter.post(
  '/send-otp',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.otpRequestsPer15Min,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  async (req, res, next) => {
    try {
      const result = await otpService.sendOtp(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

protectedRouter.post('/send-message', async (req, res, next) => {
  try {
    const result = await otpService.sendMessage(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

protectedRouter.get('/logs', async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit || '100', 10);
    const logs = await messageLog.list(limit);
    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

app.use('/api', protectedRouter);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof ZodError ? 400 : 500;
  const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join(', ') : error.message;
  logger.warn({ error: message, path: req.path }, 'Request failed');
  return res.status(status).json({ success: false, error: message });
});

app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'WhatsApp OTP API is running');
});