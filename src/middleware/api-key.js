import crypto from 'node:crypto';

function safeEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function apiKeyAuth(apiKey) {
  return (req, res, next) => {
    const provided = req.header('x-api-key') || req.query.apiKey;
    if (!safeEqual(provided, apiKey)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    return next();
  };
}