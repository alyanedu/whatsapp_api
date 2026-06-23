import { z } from 'zod';

import { config } from './config.js';
import { maskPhone, normalizePhone } from './utils/phone.js';

export const sendOtpSchema = z.object({
  phone: z.string().min(8),
  otp: z.string().regex(/^\d{4,8}$/, 'OTP must be 4 to 8 digits.'),
  purpose: z.string().max(40).optional().default('login'),
  appName: z.string().max(40).optional().default('TimberHub'),
});

export class OtpService {
  constructor({ sessionManager, messageLog }) {
    this.sessionManager = sessionManager;
    this.messageLog = messageLog;
  }

  async sendOtp(input) {
    const payload = sendOtpSchema.parse(input);
    const phone = normalizePhone(payload.phone, {
      pakistanOnly: config.pakistanOnly,
      defaultCountryCode: config.defaultCountryCode,
    });
    const text = this.#buildOtpMessage(payload);

    try {
      const result = await this.sessionManager.sendWithFailover({
        jid: phone.whatsappJid,
        text,
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

  #buildOtpMessage(payload) {
    return [
      `Your ${payload.appName} verification code is ${payload.otp}.`,
      '',
      `This code expires in ${config.otpExpiryMinutes} minutes. Do not share it with anyone.`,
    ].join('\n');
  }
}