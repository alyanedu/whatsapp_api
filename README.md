# WhatsApp OTP Gateway

Lightweight self-hosted WhatsApp OTP gateway with JSON session storage, multi-session failover, and a small HTTP API.

It is designed for teams that need a simple transactional WhatsApp sender for verification codes, internal testing, or controlled operational notifications. It uses Baileys under the hood, so it does not need Chromium or a browser process.

> This project is not affiliated with WhatsApp, Meta, or Baileys. It uses unofficial WhatsApp Web automation. Use it at your own risk, respect local laws, and do not use it for spam, bulk marketing, scraping, harassment, or abusive automation.

## Features

- JSON-based WhatsApp auth sessions under `sessions/`.
- Multiple sender sessions with priority-based failover.
- OTP endpoint with safe, simple message formatting.
- Optional generic message endpoint for controlled manual tests.
- QR login as JSON `dataUrl` or PNG image endpoint.
- API-key authentication with `X-API-Key`.
- Pakistan-only phone validation by default, configurable through `.env`.
- Worldwide sending, allow-only country lists, or blocked-country lists through `gateway.config.json`.
- Custom OTP and message templates with `{{variables}}`.
- Routing strategies: `priority`, `sequential`, or `random`.
- Per-message-type routing, such as OTP through one session group and notifications through another.
- Built-in CLI for session management, QR links, config reloads, and test sends.
- Persistent CLI defaults in `data/cli-config.json` for URL, API key, output mode, and QR behavior.
- Request rate limiting.
- File-based masked message logs.
- PM2 config for low-memory Ubuntu hosts.

## How It Works

```text
Your app / backend / automation tool
        |
        | HTTPS POST /api/send-otp
        v
WhatsApp OTP Gateway
        |
        | Baileys WhatsApp Web session
        v
Logged-in WhatsApp sender account
        |
        v
Recipient receives WhatsApp message
```

You create one or more sessions, scan the QR code with WhatsApp, and the gateway stores the resulting session auth files locally. When a send request arrives, the gateway tries connected sessions in priority order.

## Requirements

- Node.js 20 or newer.
- A WhatsApp account dedicated to transactional sending.
- A server or computer that can keep the Node process running.
- HTTPS reverse proxy for production use.

## Security Warning

The following files are credentials or private runtime data. Never commit or share them:

```text
.env
gateway.config.json
sessions/
data/cli-config.json
data/sessions.json
data/message-log.json
data/*.png
```

They are ignored by `.gitignore` by default. If they ever become public, unlink the WhatsApp device from the phone and rotate `API_KEY` immediately.

## Quick Start

```bash
npm install
cp .env.example .env
cp gateway.config.example.json gateway.config.json
```

Or let the CLI create missing local files:

```bash
npm run gateway -- setup --url http://localhost:3030
```

Edit `.env` and set a long random API key:

```env
API_KEY=replace-with-a-long-random-secret
```

Start locally:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3030/health
```

Expected response:

```json
{
  "success": true,
  "service": "whatsapp-otp-gateway",
  "time": "2026-06-23T00:00:00.000Z"
}
```

## Create A WhatsApp Session

You can use curl or the built-in CLI.

CLI:

```bash
npm run gateway -- create-session --id otp-1 --label "OTP Sender 1" --priority 1
npm run gateway -- start-session --id otp-1
npm run gateway -- qr --id otp-1
```

QR modes:

```bash
npm run gateway -- qr --id otp-1 --mode url
npm run gateway -- qr --id otp-1 --mode json
npm run gateway -- qr --id otp-1 --mode open
npm run gateway -- qr --id otp-1 --mode save --out ./otp-1-qr.png
npm run gateway -- refresh-qr --id otp-1
```

By default, `qr` requests use `refresh=true`, so an expired or missing QR is regenerated when the session is not connected. Use `--refresh false` to only read the currently cached QR.

## Replace Or Delete A Session

Replace a session when you want to discard the old local WhatsApp auth files and scan a fresh QR for the same session id:

```bash
npm run gateway -- replace-session --id otp-1
npm run gateway -- qr --id otp-1 --mode open
```

Delete a session from the gateway and remove its local auth folder:

```bash
npm run gateway -- delete-session --id otp-1
```

Ask WhatsApp to unlink/logout before deleting local files:

```bash
npm run gateway -- delete-session --id otp-1 --logout true
```

If logout fails because the socket is already closed, remove the linked device manually from the sender phone:

```text
WhatsApp -> Linked devices -> select device -> Log out
```

Curl:

Create a session:

```bash
curl -X POST http://localhost:3030/api/sessions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"id":"otp-1","label":"OTP Sender 1","priority":1}'
```

Start the session:

```bash
curl -X POST http://localhost:3030/api/sessions/otp-1/start \
  -H "X-API-Key: YOUR_API_KEY"
```

Get QR as JSON:

```bash
curl http://localhost:3030/api/sessions/otp-1/qr \
  -H "X-API-Key: YOUR_API_KEY"
```

Or open the PNG QR in a browser:

```text
http://localhost:3030/api/sessions/otp-1/qr.png?apiKey=YOUR_API_KEY
```

On your phone:

```text
WhatsApp -> Linked devices -> Link a device -> scan QR
```

Check status:

```bash
curl http://localhost:3030/api/sessions \
  -H "X-API-Key: YOUR_API_KEY"
```

You want to see:

```json
"status": "connected"
```

## Send OTP

CLI:

```bash
npm run gateway -- send-otp --phone +923001234567 --otp 482913 --appName "Example App"
```

Curl:

```bash
curl -X POST http://localhost:3030/api/send-otp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"phone":"+923001234567","otp":"482913","purpose":"login","appName":"Example App"}'
```

Default message:

```text
Your Example App verification code is 482913.

This code expires in 5 minutes. Do not share it with anyone.
```

## Send A Manual Test Message

Use this only for controlled testing or internal operational messages:

CLI:

```bash
npm run gateway -- send-message --phone +923001234567 --text "Hello from the gateway."
npm run gateway -- send-message --phone +923001234567 --template welcome --var name=Alyan
```

Curl:

```bash
curl -X POST http://localhost:3030/api/send-message \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"phone":"+923001234567","text":"Test message from WhatsApp OTP Gateway.","purpose":"manual-test"}'
```

## Multi-Session Failover

Sessions are sorted by `priority`. Lower priority numbers send first.

Example:

```json
{"id":"otp-1","label":"Primary sender","priority":1}
{"id":"otp-2","label":"Fallback sender","priority":2}
```

If `otp-1` is disconnected or sending fails, the gateway tries `otp-2`.

Configure routing in `gateway.config.json`:

```json
{
  "routing": {
    "defaultStrategy": "priority",
    "perType": {
      "otp": { "strategy": "priority", "sessions": ["otp-1", "otp-2"] },
      "order_update": { "strategy": "sequential", "sessions": ["notify-1", "notify-2"] },
      "announcement": { "strategy": "random", "sessions": ["notify-1", "notify-2"] }
    }
  }
}
```

Strategies:

- `priority`: always tries lower-priority sessions first.
- `sequential`: rotates between available sessions for that message type.
- `random`: shuffles available sessions for that message type.

The `sessions` list is optional. If omitted or empty, all connected enabled sessions are eligible.

Repeated send failures and reconnect failures are controlled by:

```env
SESSION_FAILURE_LIMIT=3
SESSION_PAUSE_SECONDS=300
RECONNECT_BASE_DELAY_SECONDS=10
RECONNECT_MAX_DELAY_SECONDS=300
RECONNECT_MAX_ATTEMPTS=5
```

If a session enters `paused`, inspect the sender phone's linked-device state, then manually restart it:

```bash
curl -X POST http://localhost:3030/api/sessions/otp-1/start \
  -H "X-API-Key: YOUR_API_KEY"
```

## Environment Variables

See `.env.example` for all options.

For country rules, templates, variables, and routing recipes, see [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Common production values:

```env
PORT=3030
HOST=127.0.0.1
NODE_ENV=production
API_KEY=replace-with-a-long-random-secret
PAKISTAN_ONLY=true
DEFAULT_COUNTRY_CODE=92
MAX_LOG_ENTRIES=200
```

Set `PAKISTAN_ONLY=false` if you want to allow non-Pakistan numbers. You are responsible for validating numbers and complying with local rules.

## Country Rules

Use `gateway.config.json` for country allow/block rules. Country codes are dial codes without `+`.

Pakistan only:

```json
{
  "phone": {
    "defaultCountryCode": "92",
    "countryPolicy": "allow",
    "allowedCountryCodes": ["92"],
    "blockedCountryCodes": []
  }
}
```

Worldwide:

```json
{
  "phone": {
    "defaultCountryCode": "1",
    "countryPolicy": "none",
    "allowedCountryCodes": [],
    "blockedCountryCodes": []
  }
}
```

Allow selected countries:

```json
{
  "phone": {
    "countryPolicy": "allow",
    "allowedCountryCodes": ["1", "44", "92"]
  }
}
```

Block selected countries:

```json
{
  "phone": {
    "countryPolicy": "block",
    "blockedCountryCodes": ["7", "98"]
  }
}
```

Reload config without restarting:

```bash
npm run gateway -- reload-config
```

or:

```bash
curl -X POST http://localhost:3030/api/config/reload \
  -H "X-API-Key: YOUR_API_KEY"
```

## CLI Defaults And Local Editing

The CLI can remember connection defaults in ignored `data/cli-config.json`:

```bash
npm run gateway -- set --url https://wa.example.com
npm run gateway -- set --key YOUR_API_KEY
npm run gateway -- set --output json
npm run gateway -- set --qrMode open
npm run gateway -- show-defaults
```

Edit `.env` values from the CLI:

```bash
npm run gateway -- env-set --key PORT --value 3030
npm run gateway -- env-set --key HOST --value 127.0.0.1
```

Edit `gateway.config.json` values from the CLI:

```bash
npm run gateway -- config-set --key phone.countryPolicy --value none
npm run gateway -- config-set --key phone.allowedCountryCodes --value '["92","1","44"]'
npm run gateway -- config-set --key routing.defaultStrategy --value sequential
```

After editing `gateway.config.json`, reload it:

```bash
npm run gateway -- reload-config
```

## Templates And Variables

Templates live in `gateway.config.json` and use `{{variable}}` placeholders.

```json
{
  "variables": {
    "appName": "Example App",
    "supportName": "Support"
  },
  "templates": {
    "otp": "Your {{appName}} code is {{otp}}. It expires in {{expiryMinutes}} minutes.",
    "messages": {
      "welcome": "Hi {{name}}, welcome to {{appName}}.",
      "order_update": "Hi {{name}}, your order {{orderNumber}} is now {{status}}."
    }
  }
}
```

Send with a named template:

```bash
npm run gateway -- send-message \
  --phone +923001234567 \
  --template order_update \
  --purpose order_update \
  --var name=Alyan \
  --var orderNumber=1001 \
  --var status=dispatched
```

The gateway rejects sends when a template variable is missing, so users do not receive messages with raw `{{placeholders}}`.

## Production Deployment With PM2

Install production dependencies:

```bash
npm install --omit=dev
```

Start with PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Low-RAM defaults:

- PM2 runs one process.
- Node heap is capped with `--max-old-space-size=256`.
- PM2 restarts the process at `300M`.
- Logs retain only the latest `MAX_LOG_ENTRIES` entries.

## Nginx Reverse Proxy

For production, do not expose port `3030` directly. Bind the API to `127.0.0.1` and put Nginx in front.

```nginx
server {
    listen 80;
    server_name wa.example.com;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Add HTTPS with Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d wa.example.com
```

Then use:

```text
https://wa.example.com
```

## Move Sessions Between Machines

Session files are not committed to git. To move a logged-in session from one trusted machine to another, copy these private files securely:

```text
sessions/
data/sessions.json
```

Example:

```bash
scp -r sessions data/sessions.json user@server:/path/to/whatsapp-otp-gateway/
```

Never upload these files to a public issue, gist, build artifact, or repository.

## API Reference

Public:

- `GET /health`

Protected with `X-API-Key`:

- `GET /api/config`
- `POST /api/config/reload`
- `GET /api/sessions`
- `POST /api/sessions`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `POST /api/sessions/:id/start`
- `POST /api/sessions/:id/replace`
- `POST /api/sessions/:id/refresh-qr`
- `POST /api/sessions/start-all`
- `POST /api/sessions/:id/logout`
- `GET /api/sessions/:id/qr`
- `GET /api/sessions/:id/qr.png`
- `POST /api/send-otp`
- `POST /api/send-message`
- `GET /api/logs`

## Automation And MCP

This gateway is just an HTTP API, so it can be called from backend jobs, Supabase Edge Functions, n8n, cron scripts, agent workflows, or an MCP server.

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for examples and safety notes.

## Responsible Use

- Send only user-requested OTPs or legitimate transactional messages.
- Do not send bulk marketing or unsolicited messages.
- Do not include links in OTP messages unless absolutely necessary.
- Keep a fallback login channel for important production systems.
- Use a dedicated sender number, not a personal or irreplaceable account.

## License

MIT. See [LICENSE](LICENSE).