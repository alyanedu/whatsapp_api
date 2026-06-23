#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { readJson, writeJson } from './utils/files.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliConfigPath = path.join(rootDir, 'data', 'cli-config.json');
const envPath = path.join(rootDir, '.env');
const gatewayConfigPath = path.join(rootDir, 'gateway.config.json');
const gatewayConfigExamplePath = path.join(rootDir, 'gateway.config.example.json');
const envExamplePath = path.join(rootDir, '.env.example');
const serverScriptPath = path.join(rootDir, 'src', 'server.js');

const aliases = {
  'reload-config': 'reloadConfig',
  'create-session': 'createSession',
  'start-session': 'startSession',
  'logout-session': 'logoutSession',
  'delete-session': 'deleteSession',
  'replace-session': 'replaceSession',
  'refresh-qr': 'refreshQr',
  'send-otp': 'sendOtp',
  'send-message': 'sendMessage',
  'env-set': 'envSet',
  'config-set': 'configSet',
  'show-defaults': 'showDefaults',
  'start-local': 'startLocal',
};

const [rawCommand = 'menu', ...rawArgs] = process.argv.slice(2);
const command = aliases[rawCommand] || rawCommand;
const args = parseArgs(rawArgs);
const defaults = await readJson(cliConfigPath, {});

try {
  await run(command, args);
} catch (error) {
  printError(error.message);
  process.exitCode = 1;
}

async function run(name, args) {
  if (name === 'menu') return menu();
  if (name === 'help' || args.help) return printHelp();
  if (name === 'setup') return setup(args);
  if (name === 'set') return setDefaults(args);
  if (name === 'showDefaults') return printJson(redact(defaults));
  if (name === 'envSet') return envSet(args);
  if (name === 'configSet') return configSet(args);
  if (name === 'startLocal') return startLocalServer();
  if (name === 'health') return request({ method: 'GET', path: '/health', auth: false }, args);
  if (name === 'sessions') return request({ method: 'GET', path: '/api/sessions' }, args);
  if (name === 'config') return request({ method: 'GET', path: '/api/config' }, args);
  if (name === 'reloadConfig') return request({ method: 'POST', path: '/api/config/reload' }, args);
  if (name === 'createSession') return createSession(args);
  if (name === 'startSession') return request({ method: 'POST', path: `/api/sessions/${requireArg(args, 'id')}/start` }, args);
  if (name === 'logoutSession') return request({ method: 'POST', path: `/api/sessions/${requireArg(args, 'id')}/logout` }, args);
  if (name === 'deleteSession') return deleteSession(args);
  if (name === 'replaceSession') return replaceSession(args);
  if (name === 'refreshQr') return request({ method: 'POST', path: `/api/sessions/${requireArg(args, 'id')}/refresh-qr` }, args);
  if (name === 'qr') return qr(args);
  if (name === 'sendOtp') return sendOtp(args);
  if (name === 'sendMessage') return sendMessage(args);
  throw new Error(`Unknown command '${name}'. Run: npm run gateway -- help`);
}

async function menu() {
  const rl = createInterface({ input, output });
  try {
    let exit = false;
    while (!exit) {
      printMenu();
      const choice = (await rl.question('Choose an option: ')).trim();
      try {
        if (choice === '1') await request({ method: 'GET', path: '/health', auth: false }, {});
        else if (choice === '2') await request({ method: 'GET', path: '/api/sessions' }, {});
        else if (choice === '3') await menuCreateSession(rl);
        else if (choice === '4') await menuSessionAction(rl, 'start');
        else if (choice === '5') await menuQr(rl);
        else if (choice === '6') await menuSessionAction(rl, 'refresh-qr');
        else if (choice === '7') await menuSessionAction(rl, 'replace');
        else if (choice === '8') await menuDeleteSession(rl);
        else if (choice === '9') await menuSendOtp(rl);
        else if (choice === '10') await menuSendMessage(rl);
        else if (choice === '11') await request({ method: 'GET', path: '/api/config' }, { output: 'json' });
        else if (choice === '12') await request({ method: 'POST', path: '/api/config/reload' }, {});
        else if (choice === '13') await startLocalServer();
        else if (choice === '14') await menuDefaults(rl);
        else if (choice === '0' || choice.toLowerCase() === 'q') exit = true;
        else printError('Unknown menu option.');
      } catch (error) {
        printError(error.message);
      }

      if (!exit) await pause(rl);
    }
  } finally {
    rl.close();
  }
}

function printMenu() {
  console.log(`
WhatsApp OTP Gateway

  1. Health check
  2. List sessions
  3. Create session
  4. Start session
  5. Open/show QR
  6. Refresh QR
  7. Replace session
  8. Delete session
  9. Send OTP
 10. Send message
 11. Show gateway config
 12. Reload gateway config
 13. Start local API server
 14. CLI setup/defaults
  0. Exit
`);
}

async function menuCreateSession(rl) {
  const id = await askRequired(rl, 'Session id (example: otp-1): ');
  const label = await rl.question('Label (optional): ');
  const priority = await rl.question('Priority (default 100): ');
  await createSession({ id, label: label || undefined, priority: priority || undefined });
}

async function menuSessionAction(rl, action) {
  const id = await askRequired(rl, 'Session id: ');
  if (action === 'start') return request({ method: 'POST', path: `/api/sessions/${id}/start` }, {});
  if (action === 'refresh-qr') return request({ method: 'POST', path: `/api/sessions/${id}/refresh-qr` }, {});
  if (action === 'replace') return replaceSession({ id });
}

async function menuQr(rl) {
  const id = await askRequired(rl, 'Session id: ');
  const mode = (await rl.question('QR mode url/json/open/save (default open): ')).trim() || 'open';
  const out = mode === 'save' ? await rl.question('Output path (optional): ') : undefined;
  return qr({ id, mode, out: out || undefined });
}

async function menuDeleteSession(rl) {
  const id = await askRequired(rl, 'Session id: ');
  const logout = await yesNo(rl, 'Ask WhatsApp to logout/unlink first?');
  return deleteSession({ id, logout: logout ? 'true' : 'false' });
}

async function menuSendOtp(rl) {
  const phone = await askRequired(rl, 'Phone: ');
  const otp = await askRequired(rl, 'OTP: ');
  const appName = await rl.question('App name (optional): ');
  const purpose = await rl.question('Purpose (default login): ');
  return sendOtp({ phone, otp, appName: appName || undefined, purpose: purpose || undefined });
}

async function menuSendMessage(rl) {
  const phone = await askRequired(rl, 'Phone: ');
  const useTemplate = await yesNo(rl, 'Use a named template?');
  if (useTemplate) {
    const template = await askRequired(rl, 'Template name: ');
    const purpose = await rl.question('Purpose/routing key (optional): ');
    const variables = await askVariables(rl);
    return sendMessage({ phone, template, purpose: purpose || template, var: variables });
  }
  const text = await askRequired(rl, 'Message text: ');
  const purpose = await rl.question('Purpose/routing key (default test): ');
  return sendMessage({ phone, text, purpose: purpose || undefined });
}

async function menuDefaults(rl) {
  console.log('\n1. Run setup\n2. Save URL\n3. Save API key\n4. Save output mode\n5. Save QR mode\n6. Show defaults\n');
  const choice = (await rl.question('Choose: ')).trim();
  if (choice === '1') {
    const url = await rl.question('Gateway URL (optional): ');
    const key = await rl.question('API key (optional): ');
    return setup({ url: url || undefined, key: key || undefined });
  }
  if (choice === '2') return setDefaults({ url: await askRequired(rl, 'Gateway URL: ') });
  if (choice === '3') return setDefaults({ key: await askRequired(rl, 'API key: ') });
  if (choice === '4') return setDefaults({ output: await askRequired(rl, 'Output mode (json/table): ') });
  if (choice === '5') return setDefaults({ qrMode: await askRequired(rl, 'QR mode (url/json/open/save): ') });
  if (choice === '6') return printJson(redact(defaults));
  printError('Unknown defaults option.');
}

async function askRequired(rl, question) {
  const value = (await rl.question(question)).trim();
  if (!value) throw new Error('Value is required.');
  return value;
}

async function yesNo(rl, question) {
  const value = (await rl.question(`${question} (y/N): `)).trim().toLowerCase();
  return value === 'y' || value === 'yes';
}

async function askVariables(rl) {
  const variables = [];
  while (true) {
    const pair = (await rl.question('Variable key=value (blank when done): ')).trim();
    if (!pair) return variables;
    variables.push(pair);
  }
}

async function pause(rl) {
  try {
    await rl.question('\nPress Enter to continue...');
  } catch {
    // stdin may be closed in piped/non-interactive runs.
  }
}

async function setup(args) {
  await copyIfMissing(envExamplePath, envPath);
  await copyIfMissing(gatewayConfigExamplePath, gatewayConfigPath);
  const nextDefaults = {
    ...defaults,
    url: args.url || defaults.url || `http://localhost:${process.env.PORT || 3030}`,
  };
  if (args.key) nextDefaults.key = args.key;
  if (args.output) nextDefaults.output = args.output;
  if (args.qrMode) nextDefaults.qrMode = args.qrMode;
  await writeJson(cliConfigPath, nextDefaults);
  printInfo('Setup complete. Created missing .env, gateway.config.json, and data/cli-config.json files.');
  printJson(redact(nextDefaults));
}

async function setDefaults(args) {
  const nextDefaults = { ...defaults };
  if (args.url) nextDefaults.url = args.url.replace(/\/$/, '');
  if (args.key) nextDefaults.key = args.key;
  if (args.output) nextDefaults.output = args.output;
  if (args.qrMode) nextDefaults.qrMode = args.qrMode;
  await writeJson(cliConfigPath, nextDefaults);
  printInfo('Saved CLI defaults.');
  printJson(redact(nextDefaults));
}

async function envSet(args) {
  const key = requireArg(args, 'key').toUpperCase();
  const value = requireArg(args, 'value');
  const current = await readEnvFile(envPath);
  current.set(key, value);
  await writeEnvFile(envPath, current);
  printInfo(`Updated .env value ${key}.`);
}

async function configSet(args) {
  const key = requireArg(args, 'key');
  const value = parseValue(requireArg(args, 'value'));
  const current = await readJson(gatewayConfigPath, await readJson(gatewayConfigExamplePath, {}));
  setDeep(current, key, value);
  await writeJson(gatewayConfigPath, current);
  printInfo(`Updated gateway.config.json path ${key}.`);
}

async function createSession(args) {
  return request(
    {
      method: 'POST',
      path: '/api/sessions',
      body: {
        id: requireArg(args, 'id'),
        label: args.label,
        priority: args.priority ? Number(args.priority) : undefined,
        enabled: args.enabled == null ? undefined : args.enabled !== 'false',
      },
    },
    args,
  );
}

async function deleteSession(args) {
  const id = requireArg(args, 'id');
  const logout = args.logout === 'true' || args.logout === true;
  return request({ method: 'DELETE', path: `/api/sessions/${id}${logout ? '?logout=true' : ''}` }, args);
}

async function replaceSession(args) {
  return request(
    {
      method: 'POST',
      path: `/api/sessions/${requireArg(args, 'id')}/replace`,
      body: {
        label: args.label,
        priority: args.priority ? Number(args.priority) : undefined,
        enabled: args.enabled == null ? undefined : args.enabled !== 'false',
      },
    },
    args,
  );
}

async function qr(args) {
  const id = requireArg(args, 'id');
  const mode = args.mode || defaults.qrMode || 'url';
  const baseUrl = getBaseUrl(args);
  const key = getApiKey(args);
  const refresh = args.refresh !== 'false';
  const url = `${baseUrl}/api/sessions/${id}/qr.png?apiKey=${encodeURIComponent(key)}${refresh ? '&refresh=true' : ''}`;

  if (mode === 'json') {
    return request({ method: 'GET', path: `/api/sessions/${id}/qr${refresh ? '?refresh=true' : ''}` }, args);
  }

  if (mode === 'save') {
    const outFile = args.out || path.join(rootDir, 'data', `${id}-qr.png`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(await response.text());
    await fs.writeFile(outFile, Buffer.from(await response.arrayBuffer()));
    printInfo(`Saved QR image to ${outFile}`);
    return;
  }

  if (mode === 'open') {
    await openUrl(url);
    printInfo(`Opened QR for '${id}' in your browser.`);
    return;
  }

  printInfo(`QR URL for '${id}':`);
  console.log(url);
}

async function sendOtp(args) {
  return request(
    {
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
    },
    args,
  );
}

async function sendMessage(args) {
  return request(
    {
      method: 'POST',
      path: '/api/send-message',
      body: {
        phone: requireArg(args, 'phone'),
        text: args.text,
        template: args.template,
        purpose: args.purpose,
        variables: parseVariables(args.var),
      },
    },
    args,
  );
}

async function request({ method, path: requestPath, auth = true, body }, args) {
  const baseUrl = getBaseUrl(args);
  const headers = {};
  if (auth) headers['X-API-Key'] = getApiKey(args);
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(compact(body)) : undefined,
    });
  } catch (error) {
    throw new Error(
      `Could not reach gateway at ${baseUrl}. Start the API with 'npm start', choose menu option 13, or set the correct URL with 'npm run gateway -- set --url <url>'. Original error: ${error.message}`,
    );
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || text || `HTTP ${response.status}`);
  printResponse(data, args);
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
  return (args.url || defaults.url || process.env.GATEWAY_URL || `http://localhost:${process.env.PORT || 3030}`).replace(/\/$/, '');
}

function getApiKey(args) {
  const key = args.key || defaults.key || process.env.API_KEY;
  if (!key) throw new Error('Missing API key. Set API_KEY, pass --key, or run: npm run gateway -- set --key YOUR_KEY');
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

function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    return JSON.parse(value);
  }
  return value;
}

function setDeep(target, dottedPath, value) {
  const parts = dottedPath.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

async function readEnvFile(filePath) {
  const raw = await readText(filePath, '');
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    map.set(line.slice(0, index), line.slice(index + 1));
  }
  return map;
}

async function writeEnvFile(filePath, map) {
  const lines = [...map.entries()].map(([key, value]) => `${key}=${value}`);
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function readText(filePath, fallback) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function copyIfMissing(from, to) {
  try {
    await fs.access(to);
  } catch {
    await fs.copyFile(from, to);
  }
}

async function openUrl(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const commandArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, commandArgs, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function startLocalServer() {
  const port = process.env.PORT || 3030;
  const child = spawn(process.execPath, [serverScriptPath], {
    cwd: rootDir,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
  });
  child.unref();
  printInfo(`Started local API server in the background on port ${port}.`);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function redact(value) {
  return { ...value, key: value.key ? '<set>' : undefined };
}

function printResponse(data, args) {
  const output = args.output || defaults.output;
  if (output === 'json') return printJson(data);
  if (Array.isArray(data.sessions)) return printSessions(data.sessions);
  if (data.session) return printSessions([data.session]);
  printJson(data);
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

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printHelp() {
  console.log(`
WhatsApp OTP Gateway CLI

Usage:
  npm run gateway                         Launch interactive menu
  npm run gateway -- <command> [options]  Run a command directly

Persistent defaults:
  setup [--url <url>] [--key <key>]      Create .env, gateway.config.json, and CLI defaults
  set --url <url>                        Save default gateway URL
  set --key <key>                        Save default API key locally
  set --output json                      Save default output mode
  set --qrMode open                      Save default QR mode
  show-defaults                          Show saved CLI defaults

Local file helpers:
  env-set --key PORT --value 3030
  config-set --key phone.countryPolicy --value none
  config-set --key phone.allowedCountryCodes --value '["92","1"]'

Connection options:
  --url <url>                            Override gateway URL
  --key <key>                            Override API key
  --output json                          Print raw JSON

Commands:
  menu
  start-local
  health
  sessions
  config
  reload-config
  create-session --id otp-1 --label "OTP Sender 1" --priority 1
  start-session --id otp-1
  logout-session --id otp-1
  delete-session --id otp-1 [--logout true]
  replace-session --id otp-1
  refresh-qr --id otp-1
  qr --id otp-1 [--mode url|json|open|save] [--refresh true|false] [--out ./qr.png]
  send-otp --phone +923001234567 --otp 482913 --appName "Example App"
  send-message --phone +923001234567 --text "Hello"
  send-message --phone +923001234567 --template welcome --var name=Alyan

Examples:
  npm run gateway -- setup --url https://wa.example.com --key YOUR_API_KEY
  npm run gateway -- start-local
  npm run gateway -- create-session --id otp-1 --label "Primary OTP" --priority 1
  npm run gateway -- start-session --id otp-1
  npm run gateway -- qr --id otp-1 --mode open
  npm run gateway -- replace-session --id otp-1
  npm run gateway -- delete-session --id otp-1 --logout true
  npm run gateway -- config-set --key phone.countryPolicy --value none
  npm run gateway -- reload-config
`);
}

function printInfo(message) {
  console.log(`\n[info] ${message}\n`);
}

function printError(message) {
  console.error(`\n[error] ${message}\n`);
}