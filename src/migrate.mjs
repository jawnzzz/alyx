#!/usr/bin/env node
/**
 * One-time importer for a career-ops `data/applications.md` tracker.
 *
 * Reads the markdown table, maps it onto ALYX application records, and writes
 * them into data/applications.json. It is READ-ONLY with respect to career-ops:
 * nothing in that directory is written, moved, or deleted.
 *
 * Dry-run by default. The tracker being imported is the only surviving record
 * of a search that already lost 46 of 53 applications once, so the default
 * behaviour is to show you what it would do and change nothing.
 *
 * Usage:
 *   node src/migrate.mjs --from ~/career-ops/data/applications.md
 *   node src/migrate.mjs --from <path> --apply
 *   node src/migrate.mjs --from <path> --apply --other "Side Job Inc"
 *
 * --other <company>   mark rows from this company as lane "other" rather than
 *                     "career". Repeatable. Use it for real jobs that are not
 *                     part of the search you are measuring, so one hire in an
 *                     unrelated lane does not make a broken funnel look solved.
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

import { load, save, makeApplication, STATUSES } from './store.mjs';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const AS_JSON = argv.includes('--json');
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const multi = (name) => argv.reduce((acc, a, i) => (a === `--${name}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

const log = (...a) => { if (!AS_JSON) console.log(...a); };

const src = String(arg('from', '~/career-ops/data/applications.md')).replace(/^~/, homedir());
if (!existsSync(src)) {
  console.error(`No tracker at ${src}. Pass --from <path>.`);
  process.exit(1);
}

const OTHER_LANE = new Set(multi('other').map(s => s.toLowerCase()));

/**
 * career-ops status -> ALYX status.
 *
 * "Evaluated" is deliberately absent: those rows are roles that were scored but
 * never applied to, which is what pipeline.json already represents. Importing
 * them would inflate the denominator of every funnel number.
 */
const STATUS_MAP = {
  applied: 'applied',
  responded: 'responded',
  interview: 'interviewing',
  offer: 'offer',
  hired: 'hired',
  rejected: 'rejected',
  discarded: 'withdrawn',
};
const SKIP_STATUS = new Set(['evaluated', 'skip']);

/** Map the header row to column indices by NAME, not position. The source
 *  tracker supports a customizable column layout, so fixed offsets break on
 *  anyone's tracker but the one this was written against. */
function columnMap(headerLine) {
  const cells = headerLine.split('|').map(c => c.trim().toLowerCase());
  const map = {};
  cells.forEach((name, i) => {
    if (['#', 'num', 'no'].includes(name)) map.num = i;
    else if (name === 'date') map.date = i;
    else if (name === 'company') map.company = i;
    else if (name === 'role') map.role = i;
    else if (name === 'score') map.score = i;
    else if (name === 'status') map.status = i;
    else if (name === 'notes') map.notes = i;
  });
  return map;
}

const lines = readFileSync(src, 'utf-8').split('\n');
const headerIdx = lines.findIndex(l => /^\s*\|/.test(l) && /\bcompany\b/i.test(l) && /\bstatus\b/i.test(l));
if (headerIdx === -1) {
  console.error(`Could not find a table header with Company and Status columns in ${src}.`);
  process.exit(1);
}

const cols = columnMap(lines[headerIdx]);
for (const required of ['company', 'status', 'date']) {
  if (cols[required] === undefined) {
    console.error(`The table in ${src} has no "${required}" column. Aborting rather than guessing.`);
    process.exit(1);
  }
}

const parsed = [];
const skipped = [];

for (const line of lines.slice(headerIdx + 1)) {
  if (!/^\s*\|/.test(line)) continue;
  const cells = line.split('|').map(c => c.trim());
  if (cells.every(c => /^-*$/.test(c))) continue; // the |---|---| separator

  const company = cells[cols.company];
  if (!company) continue;

  const rawStatus = (cells[cols.status] || '').replace(/\*/g, '').trim().toLowerCase();
  if (SKIP_STATUS.has(rawStatus)) {
    skipped.push({ company, role: cells[cols.role], reason: `status "${rawStatus}" is not an application` });
    continue;
  }

  const status = STATUS_MAP[rawStatus];
  if (!status) {
    // Never silently drop a row. An unmappable status is reported so it can be
    // fixed by hand, which is the failure mode that lost applications before.
    skipped.push({ company, role: cells[cols.role], reason: `unrecognized status "${rawStatus}"` });
    continue;
  }

  const date = (cells[cols.date] || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
  if (!date) {
    skipped.push({ company, role: cells[cols.role], reason: 'no usable date' });
    continue;
  }

  const scoreCell = cols.score !== undefined ? cells[cols.score] : '';
  const score = scoreCell?.match(/^(\d+(?:\.\d+)?)\s*\/\s*5/)?.[1];

  parsed.push({
    company,
    role: cells[cols.role] && cells[cols.role] !== '' ? cells[cols.role] : null,
    appliedAt: date,
    status,
    score: score ? Number(score) : null,
    lane: OTHER_LANE.has(company.toLowerCase()) ? 'other' : 'career',
    note: cols.notes !== undefined && cells[cols.notes] ? cells[cols.notes] : null,
  });
}

const store = load();
const existing = new Set(store.applications.map(a => `${a.company.toLowerCase()}|${(a.role || '').toLowerCase()}|${a.appliedAt}`));

const toAdd = [];
const duplicates = [];
for (const row of parsed) {
  const key = `${row.company.toLowerCase()}|${(row.role || '').toLowerCase()}|${row.appliedAt}`;
  if (existing.has(key)) { duplicates.push(row); continue; }
  existing.add(key);
  toAdd.push(row);
}

const records = toAdd.map(row => {
  const app = makeApplication({
    company: row.company,
    role: row.role,
    appliedAt: row.appliedAt,
    status: row.status,
    lane: row.lane,
    score: row.score,
    note: 'imported from career-ops tracker',
  });
  // The source note is preserved verbatim. It is often the only record of who
  // the recruiter was or what stage things actually reached.
  if (row.note) app.notes.push({ at: row.appliedAt, text: row.note });
  return app;
});

if (AS_JSON) {
  console.log(JSON.stringify({ parsed: parsed.length, adding: records.length, duplicates: duplicates.length, skipped, records }, null, 2));
} else {
  log(`source: ${src}`);
  log(`table rows parsed: ${parsed.length}`);
  log('');

  const byStatus = {};
  for (const r of records) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  for (const s of STATUSES) if (byStatus[s]) log(`  ${String(byStatus[s]).padStart(3)}  ${s}`);

  const other = records.filter(r => r.lane === 'other');
  if (other.length) {
    log('');
    log(`  lane "other" (excluded from the career funnel):`);
    for (const r of other) log(`      ${r.company} / ${r.role || 'role unknown'} (${r.status})`);
  }

  if (duplicates.length) {
    log('');
    log(`  ${duplicates.length} already in ALYX, skipping`);
  }

  if (skipped.length) {
    log('');
    log(`  ${skipped.length} row(s) not imported:`);
    for (const s of skipped) log(`      ${s.company} / ${s.role || '?'} — ${s.reason}`);
  }

  log('');
  log(APPLY ? `writing ${records.length} applications` : `would add ${records.length} applications. Re-run with --apply to write.`);
}

if (APPLY) {
  store.applications.push(...records);
  save(store);
}
