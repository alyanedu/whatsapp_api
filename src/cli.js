#!/usr/bin/env node
import 'dotenv/config';

const commands = {
  health: { method: 'GET', path: '/health', auth: false },
  sessions: { method: 'GET', path: '/api/sessions', auth: true },
  config: { method: 'GET', path: '/api/config', auth: true },
  reloadConfig: { method: 'POST', path: '/api/config/reload', auth: true },
};

const aliases = {
  'reload-config': 'reloadConfig',
  'create-session': 'createSession',
  'start-session': 'startSession',
  'logout-session': 'logoutSession',
  'send-otp': 'sendOtp',
  'send-message': 'sendMessage',
};

const [rawCommand = 'help', ...rawArgs] = process.argv.slice(2);
const command = aliases[rawCommand] || rawCommand;
const args = parseArgs(rawArgs);

try {
  await run(command, args);
} catch (error) {
  printError(error.message);
  process.exitCode = 1;
}

async function run(name, args) {
  if (name === 'help' || args.help) return printHelp();
  if (name === 'createSession') {
    return request({
      method: 'POST',
      path: '/api/sessions',
      body: {
        id: requireArg(args, 'id'),
        label: args.label,
        priority: args.priority ? Number(args.priority) : undefined,
        enabled: args.enabled == null ? undefined : args.enabled !== 'false',
      },
    });
  }
  if (name === 'startSession') {
    return request({ method: 'POST', path: `/api/sessions/${requireArg(args, 'id')}/start` });
  }
  if (name === 'logoutSession') {
    return request({ method: 'POST', path: `/api/sessions/${requireArg(args, 'id')}/logout` });
  }
  if (name === 'qr') {
    const id = requireArg(args, 'id');
    const baseUrl = getBaseUrl(args);
    printInfo(`Open this URL to scan the QR for '${id}':`);
    console.log(`${baseUrl}/api/sessions/${id}/qr.png?apiKey=${encodeURIComponent(getApiKey(args))}`);
    return;
  }
  if (name === 'sendOtp') {
    return request({
      method: 'POST',
      path: '/api/send-otp',
      body: {
        phone: requireArg(args, 'phone'),
        otp: requireArg(args, 'otp'),
        purpose: args.purpose,
        appName: args.appName,
        template: args.template,
        variables: parseVariables(args.var),
      },
    });
  }
  if (name === 'sendMessage') {
    return request({
      method: 'POST',
      path: '/api/send-message',
      body: {
        phone: requireArg(args, 'phone'),
        text: args.text,
        template: args.template,
        purpose: args.purpose,
        variables: parseVariables(args.var),
      },
    });
  }
  const simple = commands[name];
  if (simple) return request(simple);
  throw new Error(`Unknown command '${name}'. Run: npm run gateway -- help`);
}

async function request({ method, path, auth = true, body }) {
  const baseUrl = getBaseUrl(args);
  const headers = {};
  if (auth) headers['X-API-Key'] = getApiKey(args);
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(compact(body)) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || text || `HTTP ${response.status}`);
  printResponse(data);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = values[index + 1];
    const value = next && !next.startsWith('--') ? values[++index] : 'true';
    if (parsed[key] === undefined) parsed[key] = value;
    else if (Array.isArray(parsed[key])) parsed[key].push(value);
    else parsed[key] = [parsed[key], value];
  }
  return parsed;
}

function getBaseUrl(args) {
  return (args.url || process.env.GATEWAY_URL || `http://localhost:${process.env.PORT || 3030}`).replace(/\/$/, '');
}

function getApiKey(args) {
  const key = args.key || process.env.API_KEY;
  if (!key) throw new Error('Missing API key. Set API_KEY or pass --key.');
  return key;
}

function requireArg(args, key) {
  if (!args[key]) throw new Error(`Missing --${key}.`);
  return args[key];
}

function parseVariables(input) {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  const output = {};
  for (const pair of values) {
    const separator = pair.indexOf('=');
    if (separator === -1) throw new Error(`Invalid --var '${pair}'. Use key=value.`);
    output[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return output;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function printResponse(data) {
  if (Array.isArray(data.sessions)) return printSessions(data.sessions);
  if (data.session) return printSessions([data.session]);
  console.log(JSON.stringify(data, null, 2));
}

function printSessions(sessions) {
  const rows = sessions.map((session) => ({
    id: session.id,
    status: session.status,
    priority: session.priority,
    enabled: session.enabled,
    phone: session.phone || '-',
    qr: session.hasQr ? 'yes' : 'no',
    reconnects: session.reconnectAttempts ?? 0,
  }));
  console.table(rows);
}

function printHelp() {
  console.log(`
WhatsApp OTP Gateway CLI

Usage:
  npm run gateway -- <command> [options]

Connection:
  --url <url>       Gateway URL (default: GATEWAY_URL or localhost)
  --key <key>       API key (default: API_KEY)

Commands:
  health
  sessions
  config
  reload-config
  create-session --id otp-1 --label "OTP Sender 1" --priority 1
  start-session --id otp-1
  logout-session --id otp-1
  qr --id otp-1
  send-otp --phone +923001234567 --otp 482913 --appName "Example App"
  send-message --phone +923001234567 --text "Hello"
  send-message --phone +923001234567 --template welcome --var name=Alyan

Examples:
  npm run gateway -- sessions
  npm run gateway -- qr --id otp-1
  npm run gateway -- send-otp --phone +923001234567 --otp 482913 --appName "Example App"
`);
}

function printInfo(message) {
  console.log(`\n[info] ${message}\n`);
}

function printError(message) {
  console.error(`\n[error] ${message}\n`);
}