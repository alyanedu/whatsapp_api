# TimberHub WhatsApp API

Lightweight self-hosted WhatsApp OTP gateway for Pakistan-only OTP delivery. It uses Baileys, stores WhatsApp auth sessions as JSON files, and can fail over across multiple logged-in WhatsApp accounts.

This service is intentionally separate from the TimberHub Flutter app. The app integration can be planned later.

## Why This Is Lightweight

- No Chromium or browser automation.
- Plain Node.js + Express.
- WhatsApp sessions are JSON files under `sessions/`.
- Runtime logs are simple JSON files under `data/`.
- Works with PM2 on a low-end Ubuntu server.

## Low-RAM Notes

- Use `npm start` or PM2 in production, not `npm run dev`.
- Install on the server with `npm install --omit=dev`.
- Keep active WhatsApp sessions low; one primary and one fallback is a good starting point.
- PM2 is configured with `--max-old-space-size=256` and restarts at `300M`.
- Message logs keep only the latest `MAX_LOG_ENTRIES` entries, defaulting to `200`.

## Important

This uses unofficial WhatsApp Web automation. Keep volume low, use it only for transactional OTP messages, and keep fallback/recovery options for production login.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set a long `API_KEY`.

Start locally:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3030/health
```

## Create And Login A WhatsApp Session

Create a session:

```bash
curl -X POST http://localhost:3030/api/sessions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"id":"otp-1","label":"TimberHub OTP 1","priority":1}'
```

Start it:

```bash
curl -X POST http://localhost:3030/api/sessions/otp-1/start \
  -H "X-API-Key: YOUR_API_KEY"
```

Get the QR code:

```bash
curl http://localhost:3030/api/sessions/otp-1/qr \
  -H "X-API-Key: YOUR_API_KEY"
```

The response includes `dataUrl`, which you can open in a browser or render in a small admin tool later.

Create more sessions with lower priority numbers for primary accounts and higher numbers for fallback accounts.

## Send OTP

```bash
curl -X POST http://localhost:3030/api/send-otp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"phone":"+923001234567","otp":"482913","purpose":"login"}'
```

Only Pakistan numbers are allowed by default.

## Multi-Session Failover

Sessions are sorted by `priority`. Sending tries the first connected enabled session. If it fails, the API tries the next connected enabled session.

Repeated failures temporarily pause that session using these `.env` values:

```env
SESSION_FAILURE_LIMIT=3
SESSION_PAUSE_SECONDS=300
```

## Moving From Windows To Ubuntu

1. Login sessions on Windows by scanning QR codes.
2. Stop the API.
3. Copy the project to Ubuntu, including `sessions/` and `data/sessions.json`.
4. Run `npm install --omit=dev` on Ubuntu.
5. Start with PM2.

If `npm install` fails while cloning a public GitHub dependency over SSH, force GitHub dependencies through HTTPS:

```bash
git config --global url."https://github.com/".insteadOf ssh://git@github.com/
git config --global url."https://github.com/".insteadOf git@github.com:
```

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Keep `sessions/`, `data/`, and `.env` private. They are intentionally ignored by git.

## API Summary

Public:

- `GET /health`

Protected with `X-API-Key`:

- `GET /api/sessions`
- `POST /api/sessions`
- `PATCH /api/sessions/:id`
- `POST /api/sessions/:id/start`
- `POST /api/sessions/start-all`
- `POST /api/sessions/:id/logout`
- `GET /api/sessions/:id/qr`
- `GET /api/sessions/:id/qr.png`
- `POST /api/send-otp`
- `POST /api/send-message`
- `GET /api/logs`

## GitHub

Repository target:

```text
https://github.com/alyanedu/whatsapp_api
```