import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function trustProxyEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  const numberValue = Number.parseInt(value, 10);
  return Number.isFinite(numberValue) ? numberValue : value;
}

function resolveFromRoot(value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(rootDir, value);
}

export const config = {
  rootDir,
  port: intEnv('PORT', 3030),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: trustProxyEnv('TRUST_PROXY', false),
  apiKey: process.env.API_KEY || '',
  gatewayConfigPath: process.env.GATEWAY_CONFIG || './gateway.config.json',
  sessionsDir: resolveFromRoot(process.env.SESSIONS_DIR || './sessions'),
  dataDir: resolveFromRoot(process.env.DATA_DIR || './data'),
  pakistanOnly: boolEnv('PAKISTAN_ONLY', true),
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '92',
  otpExpiryMinutes: intEnv('OTP_EXPIRY_MINUTES', 5),
  sessionFailover: boolEnv('SESSION_FAILOVER', true),
  sessionFailureLimit: intEnv('SESSION_FAILURE_LIMIT', 3),
  sessionPauseSeconds: intEnv('SESSION_PAUSE_SECONDS', 300),
  reconnectBaseDelaySeconds: intEnv('RECONNECT_BASE_DELAY_SECONDS', 10),
  reconnectMaxDelaySeconds: intEnv('RECONNECT_MAX_DELAY_SECONDS', 300),
  reconnectMaxAttempts: intEnv('RECONNECT_MAX_ATTEMPTS', 5),
  requestsPerMinute: intEnv('REQUESTS_PER_MINUTE', 60),
  otpRequestsPer15Min: intEnv('OTP_REQUESTS_PER_15_MIN', 30),
  maxLogEntries: intEnv('MAX_LOG_ENTRIES', 200),
};

export function assertConfig() {
  if (!config.apiKey || config.apiKey === 'change-this-long-random-secret') {
    throw new Error('Set API_KEY in .env before starting the WhatsApp API.');
  }
}