#!/usr/bin/env node
/**
 * The local ALYX server. The browser extension's only counterparty.
 *
 * The extension is deliberately thin: it observes a page and applies what it is
 * told. Everything that knows anything lives here. That split is the whole
 * design. An extension that carried its own copy of the profile would be a
 * second source of truth, and a second source of truth is exactly the failure
 * this project exists to fix.
 *
 * Security posture, since this serves personal data and writes to the tracker:
 *
 *   - Binds to 127.0.0.1 only. Never reachable off this machine.
 *   - Requires a bearer token that is generated on first run and readable only
 *     by this user.
 *   - Sends no CORS headers at all. That is not an oversight. A page-origin
 *     fetch is meant to fail: any site you visit can attempt localhost, and
 *     without CORS the browser refuses to hand it the response. The extension
 *     reaches this server from its background worker under host_permissions,
 *     which is not subject to CORS, so the legitimate path is unaffected and
 *     the hostile one is closed.
 *
 * Usage:
 *   node src/serve.mjs            # default port 4571
 *   node src/serve.mjs --port N
 *   node src/serve.mjs --token    # print the token, for pasting into the extension
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, timingSafeEqual } from 'crypto';

import { canonicalUrl } from './normalize.mjs';
import { load, save, makeApplication, addNote, LANES } from './store.mjs';
import { catalogue, selectable } from './resumes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLICANT = join(ROOT, 'config', 'applicant.json');
const TOKEN_FILE = join(ROOT, 'data', '.server-token');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] ?? true); };
const PORT = Number(arg('port', 4571));

// ---------------------------------------------------------------- token

/** Generated once and reused. Regenerating on every boot would mean re-pairing
 *  the extension every time the server restarts. */
function loadToken() {
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf-8').trim();
  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, `${token}\n`);
  chmodSync(TOKEN_FILE, 0o600);
  return token;
}

const TOKEN = loadToken();
if (argv.includes('--token')) { console.log(TOKEN); process.exit(0); }

/** Constant-time compare, so a wrong token cannot be discovered a byte at a
 *  time by measuring how long the rejection took. */
function authorized(req) {
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (given.length !== TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));
}

// ---------------------------------------------------------------- helpers

const readJson = (p, fallback = null) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : fallback;

function send(res, code, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    // Belt and braces: this data should never be cached anywhere.
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    // A local client has no business sending a megabyte. Refuse rather than buffer.
    if (size > 256 * 1024) throw new Error('request body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

/** Strip the `_comment` keys the example file uses to document itself, so the
 *  extension never has to know they exist. */
function stripComments(v) {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_comment').map(([k, x]) => [k, stripComments(x)]));
  }
  return v;
}

// ---------------------------------------------------------------- routes

/** GET /health — reachability check. The one route that needs no token, so the
 *  extension can tell "server is down" apart from "my token is wrong". */
function health(_req, res) {
  send(res, 200, { ok: true, service: 'alyx', applicantConfigured: existsSync(APPLICANT) });
}

/** GET /profile — the standing answers used to fill a form. */
function profile(_req, res) {
  const data = readJson(APPLICANT);
  if (!data) {
    return send(res, 409, {
      error: 'no applicant profile',
      detail: 'Copy config/applicant.example.json to config/applicant.json and fill it in.',
    });
  }
  send(res, 200, stripComments(data));
}

/** GET /application?url=… — does ALYX already know about this posting?
 *  The extension asks before offering to fill, so a role already applied to is
 *  reported rather than quietly applied to twice. */
function lookup(req, res, url) {
  const target = url.searchParams.get('url');
  if (!target) return send(res, 400, { error: 'url parameter required' });

  const canonical = canonicalUrl(target);
  const store = load();
  const hit = store.applications.find(a => a.canonical === canonical);

  send(res, 200, hit
    ? { known: true, application: { id: hit.id, company: hit.company, role: hit.role, status: hit.status, appliedAt: hit.appliedAt } }
    : { known: false });
}

/**
 * POST /applied — record an application that was just submitted.
 *
 * Idempotent by canonical URL. A double-fired submit event, a page that
 * navigates and re-triggers, or a manual click after an automatic one must all
 * result in one record. Returning the existing record rather than an error lets
 * the extension treat "already recorded" as success, which is what it is.
 */
async function applied(req, res) {
  let payload;
  try { payload = await body(req); }
  catch (e) { return send(res, 400, { error: e.message }); }

  const { company, role = null, url = null, source = null, resumeUsed = null,
          resumeVariant = null, resumeTags = null, lane = 'career', note = null, answers = null } = payload;

  if (!company) return send(res, 400, { error: 'company is required' });
  if (!LANES.includes(lane)) return send(res, 400, { error: `unknown lane "${lane}"` });

  const store = load();
  const canonical = url ? canonicalUrl(url) : null;

  const existing = canonical && store.applications.find(a => a.canonical === canonical);
  if (existing) return send(res, 200, { created: false, application: existing });

  const app = makeApplication({ company, role, url, source, lane, note: note || 'submitted via ALYX' });

  // The point of the whole feature: which resume went where. Without this the
  // tracker can count applications but can never tell you which version works.
  app.resumeUsed = resumeUsed;
  app.resumeVariant = resumeVariant;
  // Tags carry which optional entries this resume included, so the outcome can
  // later be compared against the choice.
  app.resumeTags = resumeTags;

  // Screening answers are kept so a future application can reuse them, and so a
  // wrong answer is traceable to the applications it went out on.
  if (answers && typeof answers === 'object') app.answers = answers;

  store.applications.push(app);
  save(store);

  send(res, 201, { created: true, application: app });
}


/** GET /resumes — the resume library, read live off disk.
 *
 *  The archive is included but flagged, because it is history: knowing which
 *  resume went to which employer is the whole point of recording this, but the
 *  archive is
 *  never a choice for a new application. */
function resumes(_req, res, url) {
  const all = url.searchParams.get('all') === '1';
  const rows = all ? catalogue() : selectable();
  send(res, 200, { count: rows.length, resumes: rows });
}

// ---------------------------------------------------------------- server

const ROUTES = {
  'GET /health': health,
  'GET /profile': profile,
  'GET /application': lookup,
  'GET /resumes': resumes,
  'POST /applied': applied,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const key = `${req.method} ${url.pathname}`;
  const handler = ROUTES[key];

  if (!handler) return send(res, 404, { error: `no route for ${key}` });
  if (key !== 'GET /health' && !authorized(req)) return send(res, 401, { error: 'bad or missing token' });

  try {
    await handler(req, res, url);
  } catch (e) {
    // Never leak a stack trace to a caller, but never swallow it either: a
    // silent 500 during an application is the worst possible time to be quiet.
    console.error(`[${new Date().toISOString()}] ${key} failed:`, e);
    send(res, 500, { error: 'internal error', detail: e.message });
  }
});

/** An already-running ALYX is the most likely reason this port is taken, and it
 *  is not an error worth a stack trace. Say what happened in one line. */
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. ALYX is probably already running.`);
    console.error(`Check with: curl -s http://127.0.0.1:${PORT}/health`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ALYX server on http://127.0.0.1:${PORT}  (localhost only)`);
  console.log(`token: node src/serve.mjs --token`);
  if (!existsSync(APPLICANT)) {
    console.log(`\nNo config/applicant.json yet. Copy config/applicant.example.json and fill it in,`);
    console.log(`or /profile will keep returning 409.`);
  }
});
