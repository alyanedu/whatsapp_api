export function normalizePhone(input, options = {}) {
  const defaultCountryCode = options.defaultCountryCode || '92';
  const countryPolicy = options.countryPolicy || (options.pakistanOnly ? 'allow' : 'none');
  const allowedCountryCodes = options.allowedCountryCodes ?? (options.pakistanOnly ? ['92'] : []);
  const blockedCountryCodes = options.blockedCountryCodes ?? [];
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

  const allowedMatch = findCountryCode(digits, allowedCountryCodes);
  const blockedMatch = findCountryCode(digits, blockedCountryCodes);

  if (countryPolicy === 'allow' && allowedCountryCodes.length > 0 && !allowedMatch) {
    throw new Error(`Phone country code is not allowed. Allowed country codes: ${allowedCountryCodes.join(', ')}.`);
  }

  if (countryPolicy === 'block' && blockedMatch) {
    throw new Error(`Phone country code ${blockedMatch} is blocked.`);
  }

  return {
    e164: `+${digits}`,
    digits,
    countryCode: allowedMatch || findCountryCode(digits, [defaultCountryCode]) || null,
    whatsappJid: `${digits}@s.whatsapp.net`,
  };
}

function findCountryCode(digits, countryCodes) {
  return [...countryCodes]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .find((code) => digits.startsWith(code));
}

export function maskPhone(phone) {
  const text = String(phone || '');
  if (text.length <= 7) return '***';
  return `${text.slice(0, 5)}****${text.slice(-3)}`;
}