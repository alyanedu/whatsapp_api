import path from 'node:path';
import { config } from './config.js';
import { readJson, writeJson } from './utils/files.js';

export class MessageLog {
  constructor() {
    this.filePath = path.join(config.dataDir, 'message-log.json');
  }

  async append(entry) {
    const logs = await readJson(this.filePath, []);
    logs.unshift({ time: new Date().toISOString(), ...entry });
    await writeJson(this.filePath, logs.slice(0, config.maxLogEntries));
  }

  async list(limit = 100) {
    const logs = await readJson(this.filePath, []);
    return logs.slice(0, Math.max(1, Math.min(limit, config.maxLogEntries)));
  }
}