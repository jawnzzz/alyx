#!/usr/bin/env node
/**
 * ALYX tracker. Records what you applied to and what happened next.
 *
 * The scanner and evaluator answer "what should I look at." This answers
 * "what did I send, when, and did anyone reply." Adding an application pulls
 * its details out of the pipeline rather than asking you to retype them,
 * because a tracker you have to hand-fill is a tracker that quietly goes stale.
 *
 * Usage:
 *   node src/track.mjs add <url | company>   [--role R] [--date YYYY-MM-DD] [--lane career|other] [--note "..."]
 *   node src/track.mjs list                  [--status S] [--lane L] [--stale N] [--json]
 *   node src/track.mjs status <id|company> <status> [--note "..."] [--date YYYY-MM-DD]
 *   node src/track.mjs note <id|company> "text"
 *   node src/track.mjs stats                 [--lane L] [--json]
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { canonicalUrl } from './normalize.mjs';
import {
  load, save, find, makeApplication, setStatus, addNote,
  furthest, daysSince, STATUSES, LANES, TERMINAL,
} from './store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE = join(ROOT, 'data', 'pipeline.json');
const EVALUATIONS = join(ROOT, 'data', 'evaluations.json');

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const AS_JSON = argv.includes('--json');

const readJson = (p, fallback) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : fallback;
const log = (...a) => { if (!AS_JSON) console.log(...a); };
const die = (msg) => { console.error(msg); process.exit(1); };

/** Roles ALYX already knows about, from the scanner and the evaluator. Keyed by
 *  canonical URL so `add <url>` needs nothing but the link. */
function knownRoles() {
  const rows = [
    ...(readJson(PIPELINE, []) || []),
    ...(readJson(EVALUATIONS, []) || []),
  ];
  const byCanonical = new Map();
  for (const r of rows) {
    const key = r.canonical || (r.url ? canonicalUrl(r.url) : null);
    if (key) byCanonical.set(key, { ...(byCanonical.get(key) || {}), ...r });
  }
  return byCanonical;
}

function pad(s, n) { return String(s ?? '').padEnd(n).slice(0, n); }

// ---------------------------------------------------------------- add

function cmdAdd() {
  const target = positional[0];
  if (!target) die('usage: track.mjs add <url | company> [--role R] [--date YYYY-MM-DD]');

  const data = load();
  const isUrl = /^https?:\/\//i.test(target);
  const canonical = isUrl ? canonicalUrl(target) : null;

  // Pull everything we can from what ALYX already scanned, so applying to a
  // role it found costs one command and no retyping.
  const known = canonical ? knownRoles().get(canonical) : null;

  const company = arg('company') || known?.company || (isUrl ? null : target);
  if (!company) die('could not work out the company. Pass --company.');

  const role = arg('role') || known?.title || null;
  const date = arg('date') || new Date().toISOString().slice(0, 10);
  const lane = arg('lane') || 'career';
  if (!LANES.includes(lane)) die(`unknown lane "${lane}" (expected: ${LANES.join(', ')})`);

  const existing = data.applications.find(a => canonical && a.canonical === canonical);
  if (existing) die(`already tracked as ${existing.id}: ${existing.company} / ${existing.role || 'role unknown'} (${existing.status})`);

  const app = makeApplication({
    company,
    role,
    url: isUrl ? target : null,
    source: known?.source || null,
    appliedAt: date,
    status: arg('status') || 'applied',
    lane,
    score: known?.score ?? null,
    verdict: known?.verdict ?? null,
    note: arg('note'),
  });

  data.applications.push(app);
  save(data);

  if (AS_JSON) return console.log(JSON.stringify(app, null, 2));
  log(`added ${app.id}  ${app.company}  ${app.role || '(role unknown)'}  ${app.status}  ${app.appliedAt}`);
  if (known) log('  details pulled from the pipeline, nothing retyped');
}

// ---------------------------------------------------------------- list

function cmdList() {
  const data = load();
  const stale = Number(arg('stale', 0)) || 0;
  const wantStatus = arg('status');
  const wantLane = arg('lane');

  let rows = data.applications;
  if (wantStatus) rows = rows.filter(a => a.status === wantStatus);
  if (wantLane) rows = rows.filter(a => a.lane === wantLane);
  if (stale) rows = rows.filter(a => !TERMINAL.has(a.status) && daysSince(a) >= stale);

  rows = rows.sort((a, b) => (b.history.at(-1)?.at || '').localeCompare(a.history.at(-1)?.at || ''));

  if (AS_JSON) return console.log(JSON.stringify(rows, null, 2));

  if (!rows.length) return log('nothing matches.');
  log(`${pad('id', 11)}${pad('date', 12)}${pad('company', 22)}${pad('role', 40)}${pad('status', 14)}quiet`);
  for (const a of rows) {
    const quiet = TERMINAL.has(a.status) ? '' : `${daysSince(a)}d`;
    log(`${pad(a.id, 11)}${pad(a.appliedAt, 12)}${pad(a.company, 22)}${pad(a.role || '', 40)}${pad(a.status, 14)}${quiet}`);
  }
  log(`\n${rows.length} shown, ${data.applications.length} tracked`);
}

// ---------------------------------------------------------------- status

function cmdStatus() {
  const [selector, next] = positional;
  if (!selector || !next) die(`usage: track.mjs status <id|company> <${STATUSES.join('|')}>`);

  const data = load();
  const matches = find(data, selector);
  if (!matches?.length) die(`no application matches "${selector}"`);
  if (matches.length > 1) {
    console.error(`"${selector}" matches ${matches.length} applications. Use an id:`);
    for (const m of matches) console.error(`  ${m.id}  ${m.company}  ${m.role || ''} (${m.status})`);
    process.exit(1);
  }

  const app = matches[0];
  const before = app.status;
  setStatus(app, next, { note: arg('note'), at: arg('date') });
  save(data);

  if (AS_JSON) return console.log(JSON.stringify(app, null, 2));
  log(`${app.id}  ${app.company}  ${before} -> ${app.status}`);
}

// ---------------------------------------------------------------- note

function cmdNote() {
  const [selector, ...rest] = positional;
  const text = rest.join(' ');
  if (!selector || !text) die('usage: track.mjs note <id|company> "text"');

  const data = load();
  const matches = find(data, selector);
  if (!matches?.length) die(`no application matches "${selector}"`);
  if (matches.length > 1) die(`"${selector}" is ambiguous, use an id`);

  addNote(matches[0], text);
  save(data);
  log(`noted on ${matches[0].id}`);
}

// ---------------------------------------------------------------- stats

function cmdStats() {
  const data = load();
  const wantLane = arg('lane');
  const rows = wantLane ? data.applications.filter(a => a.lane === wantLane) : data.applications;

  // Funnel counts "ever reached", not "currently sitting at". A rejection after
  // an interview is still an interview that happened.
  const ever = {};
  for (const s of STATUSES) ever[s] = 0;
  for (const a of rows) {
    for (const s of new Set(a.history.map(h => h.status))) if (ever[s] !== undefined) ever[s] += 1;
  }

  const applied = rows.length;

  // Two different questions, and conflating them is how a funnel misleads.
  // "Engaged" is anyone who moved you forward. "Any reply" includes rejections,
  // because a rejection email still means a human opened your application. A
  // search with 2% engagement and 16% replies has a different problem than one
  // where nothing comes back at all.
  // Count APPLICATIONS, not status-bucket memberships. Summing the buckets
  // double-counts anything that reached two of them, which is every application
  // that got an interview and was then rejected: CoStar appeared in both
  // `interviewing` and `rejected` and inflated the reply rate from 26.4% to
  // 27.8%. The bug only surfaced once interview history was backfilled, because
  // before that those applications knew only their final status.
  const FORWARD = ['responded', 'interviewing', 'offer', 'hired'];
  const reached = (a, set) => a.history.some(h => set.includes(h.status));
  const engaged = rows.filter(a => reached(a, FORWARD)).length;
  const anyReply = rows.filter(a => reached(a, [...FORWARD, 'rejected'])).length;
  const rate = applied ? ((engaged / applied) * 100).toFixed(1) : '0.0';
  const replyRate = applied ? ((anyReply / applied) * 100).toFixed(1) : '0.0';

  const byLane = {};
  for (const a of data.applications) byLane[a.lane] = (byLane[a.lane] || 0) + 1;

  const out = {
    applied,
    everEngaged: engaged,
    anyReply,
    everInterviewed: ever.interviewing,
    everOffered: ever.offer + ever.hired,
    hired: ever.hired,
    rejected: ever.rejected,
    withdrawn: ever.withdrawn,
    silent: applied - anyReply - ever.withdrawn,
    engagementRate: `${rate}%`,
    anyReplyRate: `${replyRate}%`,
    open: rows.filter(a => !TERMINAL.has(a.status)).length,
    quiet30: rows.filter(a => !TERMINAL.has(a.status) && daysSince(a) >= 30).length,
    byLane,
  };

  if (AS_JSON) return console.log(JSON.stringify(out, null, 2));

  log(`applied            ${out.applied}`);
  log(`any reply          ${out.anyReply}   (${out.anyReplyRate})   includes rejections`);
  log(`engaged            ${out.everEngaged}   (${out.engagementRate})   moved you forward`);
  log(`ever interviewed   ${out.everInterviewed}`);
  log(`ever offered       ${out.everOffered}`);
  log(`hired              ${out.hired}`);
  log(`rejected           ${out.rejected}`);
  log(`withdrawn          ${out.withdrawn}`);
  log(`never heard back   ${out.silent}`);
  log(`\nstill open         ${out.open}`);
  log(`quiet 30+ days     ${out.quiet30}`);
  if (Object.keys(byLane).length > 1) {
    log(`\nby lane            ${Object.entries(byLane).map(([k, v]) => `${k}: ${v}`).join('   ')}`);
    log('(run with --lane career to exclude everything else)');
  }
}

// ----------------------------------------------------------------

const COMMANDS = { add: cmdAdd, list: cmdList, status: cmdStatus, note: cmdNote, stats: cmdStats };

if (!COMMANDS[cmd]) {
  console.error(`usage: track.mjs <${Object.keys(COMMANDS).join('|')}>  (see the header of this file)`);
  process.exit(1);
}
COMMANDS[cmd]();
