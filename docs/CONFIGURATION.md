# Configuration Guide

Runtime behavior is controlled by two files:

- `.env` for secrets, paths, ports, and operational limits.
- `gateway.config.json` for country rules, templates, variables, and session routing.

Start from the example files:

```bash
cp .env.example .env
cp gateway.config.example.json gateway.config.json
```

`gateway.config.json` is ignored by git because it may contain business-specific routing or message wording.

The CLI also stores local defaults in `data/cli-config.json`, which is ignored by git because it may contain your gateway URL or API key.

## Phone Country Rules

Country codes are dial codes without `+`.

### Worldwide

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

### Allow Only Selected Countries

```json
{
  "phone": {
    "defaultCountryCode": "92",
    "countryPolicy": "allow",
    "allowedCountryCodes": ["92", "1", "44"],
    "blockedCountryCodes": []
  }
}
```

### Block Selected Countries

```json
{
  "phone": {
    "defaultCountryCode": "1",
    "countryPolicy": "block",
    "allowedCountryCodes": [],
    "blockedCountryCodes": ["7", "98"]
  }
}
```

## Templates

Templates use `{{variable}}` placeholders.

```json
{
  "variables": {
    "appName": "Example App",
    "supportName": "Support"
  },
  "templates": {
    "otp": "Your {{appName}} verification code is {{otp}}.\n\nThis code expires in {{expiryMinutes}} minutes.",
    "messages": {
      "welcome": "Hi {{name}}, welcome to {{appName}}.",
      "order_update": "Hi {{name}}, order {{orderNumber}} is now {{status}}."
    }
  }
}
```

Variables are merged in this order:

1. Global `variables` from `gateway.config.json`.
2. Request `variables`.
3. Built-in request variables such as `otp`, `purpose`, `expiryMinutes`, and `appName`.

If a required template variable is missing, the gateway rejects the send.

## Routing Strategies

Routing decides which connected sender session should send a message.

```json
{
  "routing": {
    "defaultStrategy": "priority",
    "perType": {
      "otp": {
        "strategy": "priority",
        "sessions": ["otp-1", "otp-2"]
      },
      "order_update": {
        "strategy": "sequential",
        "sessions": ["notify-1", "notify-2"]
      },
      "announcement": {
        "strategy": "random",
        "sessions": ["notify-1", "notify-2"]
      }
    }
  }
}
```

Available strategies:

- `priority`: use session priority order.
- `sequential`: rotate across eligible sessions.
- `random`: shuffle eligible sessions before each send.

The request field `purpose` controls message routing for `/api/send-message`. OTP sends use the `otp` route.

## Reload Config

After editing `gateway.config.json`, reload without restarting:

```bash
npm run gateway -- reload-config
```

or:

```bash
curl -X POST http://localhost:3030/api/config/reload \
  -H "X-API-Key: YOUR_API_KEY"
```

## CLI Session Lifecycle

Create, scan, replace, or delete sessions from the CLI:

```bash
npm run gateway -- create-session --id otp-1 --label "Primary OTP" --priority 1
npm run gateway -- start-session --id otp-1
npm run gateway -- qr --id otp-1 --mode open
npm run gateway -- refresh-qr --id otp-1
npm run gateway -- replace-session --id otp-1
npm run gateway -- delete-session --id otp-1 --logout true
```

Use `replace-session` when a session becomes stale or you want to re-link the same sender slot with a new QR code.

## Example: Worldwide OTP Gateway

```json
{
  "phone": {
    "defaultCountryCode": "1",
    "countryPolicy": "none",
    "allowedCountryCodes": [],
    "blockedCountryCodes": []
  },
  "routing": {
    "defaultStrategy": "sequential",
    "perType": {
      "otp": { "strategy": "sequential", "sessions": ["otp-1", "otp-2"] }
    }
  },
  "variables": {
    "appName": "Example App"
  },
  "templates": {
    "otp": "Your {{appName}} code is {{otp}}. It expires in {{expiryMinutes}} minutes.",
    "messages": {}
  }
}
```