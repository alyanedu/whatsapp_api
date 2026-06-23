export function normalizePhone(input, options = {}) {
  const defaultCountryCode = options.defaultCountryCode || '92';
  const pakistanOnly = options.pakistanOnly ?? true;
  let digits = String(input || '').replace(/[^0-9+]/g, '');

  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `${defaultCountryCode}${digits.slice(1)}`;
  if (!digits.startsWith(defaultCountryCode) && digits.length === 10) {
    digits = `${defaultCountryCode}${digits}`;
  }

  if (!/^\d{10,15}$/.test(digits)) {
    throw new Error('Invalid phone number format. Use +923001234567.');
  }

  if (pakistanOnly && !digits.startsWith('92')) {
    throw new Error('Only Pakistan phone numbers are allowed.');
  }

  if (pakistanOnly && !/^92[0-9]{10}$/.test(digits)) {
    throw new Error('Pakistan phone numbers must look like +923001234567.');
  }

  return {
    e164: `+${digits}`,
    digits,
    whatsappJid: `${digits}@s.whatsapp.net`,
  };
}

export function maskPhone(phone) {
  const text = String(phone || '');
  if (text.length <= 7) return '***';
  return `${text.slice(0, 5)}****${text.slice(-3)}`;
}