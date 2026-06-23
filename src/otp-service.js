import { z } from 'zod';

import { config } from './config.js';
import { maskPhone, normalizePhone } from './utils/phone.js';
import { findMissingVariables, renderTemplate } from './template-service.js';

export const sendOtpSchema = z.object({
  phone: z.string().min(8),
  otp: z.string().regex(/^\d{4,8}$/, 'OTP must be 4 to 8 digits.'),
  purpose: z.string().max(40).optional().default('login'),
  appName: z.string().max(40).optional().default('Your app'),
  template: z.string().min(1).optional(),
  variables: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().default({}),
});

export const sendMessageSchema = z.object({
  phone: z.string().min(8),
  text: z.string().min(1).max(1000).optional(),
  template: z.string().min(1).optional(),
  variables: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().default({}),
  purpose: z.string().max(40).optional().default('test'),
}).refine((value) => value.text || value.template, 'Either text or template is required.');

export class OtpService {
  constructor({ sessionManager, messageLog, gatewayConfig }) {
    this.sessionManager = sessionManager;
    this.messageLog = messageLog;
    this.gatewayConfig = gatewayConfig;
  }

  async sendOtp(input) {
    const payload = sendOtpSchema.parse(input);
    const gatewayConfig = this.gatewayConfig.get();
    const phone = this.#normalize(payload.phone, gatewayConfig);
    const text = this.#buildOtpMessage(payload, gatewayConfig);
    const route = this.#routeFor('otp', gatewayConfig);

    try {
      const result = await this.sessionManager.sendWithFailover({
        jid: phone.whatsappJid,
        text,
        messageType: 'otp',
        route,
      });
      await this.messageLog.append({
        type: 'otp',
        phoneMasked: maskPhone(phone.e164),
        purpose: payload.purpose,
        sessionId: result.sessionId,
        success: true,
        messageId: result.messageId,
      });
      return {
        success: true,
        phone: maskPhone(phone.e164),
        sessionId: result.sessionId,
        messageId: result.messageId,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      await this.messageLog.append({
        type: 'otp',
        phoneMasked: maskPhone(phone.e164),
        purpose: payload.purpose,
        success: false,
        error: error.message,
      });
      throw error;
    }
  }

  async sendMessage(input) {
    const payload = sendMessageSchema.parse(input);
    const gatewayConfig = this.gatewayConfig.get();
    const phone = this.#normalize(payload.phone, gatewayConfig);
    const text = this.#buildCustomMessage(payload, gatewayConfig);
    const route = this.#routeFor(payload.purpose || 'message', gatewayConfig);

    try {
      const result = await this.sessionManager.sendWithFailover({
        jid: phone.whatsappJid,
        text,
        messageType: payload.purpose || 'message',
        route,
      });
      await this.messageLog.append({
        type: 'message',
        phoneMasked: maskPhone(phone.e164),
        purpose: payload.purpose,
        sessionId: result.sessionId,
        success: true,
        messageId: result.messageId,
      });
      return {
        success: true,
        phone: maskPhone(phone.e164),
        sessionId: result.sessionId,
        messageId: result.messageId,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      await this.messageLog.append({
        type: 'message',
        phoneMasked: maskPhone(phone.e164),
        purpose: payload.purpose,
        success: false,
        error: error.message,
      });
      throw error;
    }
  }

  #normalize(phone, gatewayConfig) {
    return normalizePhone(phone, gatewayConfig.phone);
  }

  #routeFor(messageType, gatewayConfig) {
    return gatewayConfig.routing.perType[messageType] || gatewayConfig.routing.perType.message || {
      strategy: gatewayConfig.routing.defaultStrategy,
      sessions: [],
    };
  }

  #buildOtpMessage(payload, gatewayConfig) {
    const variables = {
      ...gatewayConfig.variables,
      ...payload.variables,
      otp: payload.otp,
      purpose: payload.purpose,
      appName: payload.appName || gatewayConfig.variables.appName,
      expiryMinutes: config.otpExpiryMinutes,
    };
    const template = payload.template || gatewayConfig.templates.otp;
    return this.#renderChecked(template, variables);
  }

  #buildCustomMessage(payload, gatewayConfig) {
    const variables = {
      ...gatewayConfig.variables,
      ...payload.variables,
      purpose: payload.purpose,
    };
    const template = payload.text || gatewayConfig.templates.messages[payload.template];
    if (!template) throw new Error(`Message template '${payload.template}' was not found.`);
    return this.#renderChecked(template, variables);
  }

  #renderChecked(template, variables) {
    const missing = findMissingVariables(template, variables);
    if (missing.length > 0) {
      throw new Error(`Missing template variables: ${missing.join(', ')}.`);
    }
    return renderTemplate(template, variables);
  }
}