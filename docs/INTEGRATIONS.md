# Integrations

The gateway exposes a small HTTP API. Any backend, workflow runner, or agent tool that can make authenticated HTTP requests can use it.

Use HTTPS in production and store `API_KEY` in your platform's secret manager. Do not put the API key in frontend/mobile apps.

## Backend OTP Flow

Recommended architecture:

```text
Client app
  -> Your backend / auth service
     -> WhatsApp OTP Gateway
        -> WhatsApp sender session
```

Avoid:

```text
Client app -> WhatsApp OTP Gateway
```

because API keys embedded in client apps can be extracted.

## Send OTP From Node.js

```js
const response = await fetch('https://wa.example.com/api/send-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.WHATSAPP_GATEWAY_API_KEY,
  },
  body: JSON.stringify({
    phone: '+923001234567',
    otp: '482913',
    purpose: 'login',
    appName: 'Example App',
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

console.log(await response.json());
```

## Supabase Edge Function Pattern

Use an Edge Function or server-side hook to call the gateway. Store the gateway key with Supabase secrets.

```bash
supabase secrets set WHATSAPP_GATEWAY_URL=https://wa.example.com
supabase secrets set WHATSAPP_GATEWAY_API_KEY=replace-with-secret
```

Pseudo-code:

```ts
await fetch(`${Deno.env.get('WHATSAPP_GATEWAY_URL')}/api/send-otp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': Deno.env.get('WHATSAPP_GATEWAY_API_KEY')!,
  },
  body: JSON.stringify({ phone, otp, appName: 'Example App' }),
});
```

## MCP And Agent Workflows

You can expose this gateway to agents through a small MCP server or any MCP-compatible HTTP tool. Keep the gateway API key on the server side of the tool, not in prompts or user-visible config.

Suggested MCP tool shape:

```json
{
  "name": "send_whatsapp_otp",
  "description": "Send a user-requested WhatsApp OTP through the self-hosted gateway.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "phone": { "type": "string", "description": "Recipient phone number in E.164 format" },
      "otp": { "type": "string", "description": "4-8 digit OTP" },
      "appName": { "type": "string", "description": "Application name in the OTP text" }
    },
    "required": ["phone", "otp"]
  }
}
```

The MCP server implementation should call:

```text
POST /api/send-otp
```

with `X-API-Key` from an environment variable.

Safety rules for agent/MCP use:

- Only send OTPs after a user explicitly requests one.
- Do not let agents send arbitrary bulk messages.
- Validate phone numbers server-side.
- Rate-limit by user, phone, and IP.
- Keep audit logs masked.
- Never return `API_KEY`, session file content, QR raw strings, or logs with full phone numbers to the agent.

## n8n Or Workflow Tools

Use an HTTP Request node:

- Method: `POST`
- URL: `https://wa.example.com/api/send-otp`
- Header: `X-API-Key: <secret>`
- Body: JSON

```json
{
  "phone": "+923001234567",
  "otp": "482913",
  "purpose": "login",
  "appName": "Example App"
}
```

## Curl Smoke Tests

```bash
curl https://wa.example.com/health
```

```bash
curl https://wa.example.com/api/sessions \
  -H "X-API-Key: YOUR_API_KEY"
```

```bash
curl -X POST https://wa.example.com/api/send-otp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"phone":"+923001234567","otp":"482913","appName":"Example App"}'
```