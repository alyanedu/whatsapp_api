import path from 'node:path';
import { z } from 'zod';

import { config } from './config.js';
import { readJson } from './utils/files.js';

const strategySchema = z.enum(['priority', 'sequential', 'random']);

const routeSchema = z.object({
  strategy: strategySchema.optional(),
  sessions: z.array(z.string().min(1)).optional(),
});

const gatewayConfigSchema = z.object({
  phone: z
    .object({
      defaultCountryCode: z.string().regex(/^\d+$/).optional(),
      countryPolicy: z.enum(['allow', 'block', 'none']).optional(),
      allowedCountryCodes: z.array(z.string().regex(/^\d+$/)).optional(),
      blockedCountryCodes: z.array(z.string().regex(/^\d+$/)).optional(),
    })
    .optional(),
  routing: z
    .object({
      defaultStrategy: strategySchema.optional(),
      perType: z.record(routeSchema).optional(),
    })
    .optional(),
  variables: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  templates: z
    .object({
      otp: z.string().min(1).optional(),
      messages: z.record(z.string().min(1)).optional(),
    })
    .optional(),
});

const defaultGatewayConfig = {
  phone: {
    defaultCountryCode: config.defaultCountryCode,
    countryPolicy: config.pakistanOnly ? 'allow' : 'none',
    allowedCountryCodes: config.pakistanOnly ? ['92'] : [],
    blockedCountryCodes: [],
  },
  routing: {
    defaultStrategy: 'priority',
    perType: {
      otp: { strategy: 'priority', sessions: [] },
      message: { strategy: 'priority', sessions: [] },
    },
  },
  variables: {
    appName: 'Your app',
  },
  templates: {
    otp: 'Your {{appName}} verification code is {{otp}}.\n\nThis code expires in {{expiryMinutes}} minutes. Do not share it with anyone.',
    messages: {
      test: 'Test message from {{appName}}.',
    },
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(base[key] ?? {}, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

export class GatewayConfigStore {
  constructor() {
    this.configPath = path.isAbsolute(config.gatewayConfigPath)
      ? config.gatewayConfigPath
      : path.resolve(config.rootDir, config.gatewayConfigPath);
    this.value = defaultGatewayConfig;
  }

  async load() {
    const userConfig = await readJson(this.configPath, {});
    const parsed = gatewayConfigSchema.parse(userConfig);
    this.value = deepMerge(defaultGatewayConfig, parsed);
    return this.value;
  }

  get() {
    return this.value;
  }

  publicConfig() {
    return this.value;
  }
}