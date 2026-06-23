# Security Policy

## Supported Versions

This project is early-stage. Security fixes should target the latest `main` branch unless a maintained release branch exists.

## Secrets And Session Files

Never commit, upload, or share:

```text
.env
gateway.config.json
sessions/
data/cli-config.json
data/sessions.json
data/message-log.json
data/*.png
```

WhatsApp session files are credentials. Anyone with those files may be able to reuse a linked-device session.

If session files are exposed:

1. Open WhatsApp on the sender phone.
2. Go to `Linked devices`.
3. Log out the exposed device.
4. Delete the exposed session files.
5. Rotate `API_KEY`.
6. Review recent message logs.

## Deployment Guidance

- Put the gateway behind HTTPS.
- Prefer `HOST=127.0.0.1` behind Nginx instead of exposing port `3030` directly.
- Use a long random `API_KEY`.
- Restrict network access where possible.
- Keep logs masked and short-lived.
- Do not run with debug logs in production.

## Responsible Disclosure

If you discover a security issue, report it privately to the repository owner instead of opening a public issue with exploit details or secrets.

Do not include real session files, API keys, message logs, QR codes, or phone numbers in reports.