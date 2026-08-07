#!/usr/bin/env node
/**
 * ALYX scanner. Reads config/boards.json, hits each public ATS endpoint,
 * normalizes, filters and dedupes, then appends new roles to data/pipeline.json.
 *
 * Zero LLM cost. Zero API keys. Every provider here talks to a documented
 * public job-board endpoint.
 *
 * Usage:
 *   node src/scan.mjs                 # scan everything in config/boards.json
 *   node src/scan.mjs --since 7       # only roles posted in the last 7 days
 *   node src/scan.mjs --dry-run       # show what would be added, write nothing
 *   node src/scan.mjs --json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import * as greenhouse from './providers/greenhouse.mjs';
import * as ashby from './providers/ashby.mjs';
import * as lever from './providers/lever.mjs';
import * as workday from './providers/workday.mjs';
import { isUsable, dedupe, newerThan } from './filter.mjs';
import { load as loadApplications, appliedCanonicals } from './store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'config', 'boards.json');
const PIPELINE = join(ROOT, 'data', 'pipeline.json');
const SEEN = join(ROOT, 'data', 'seen.json');

const PROVIDERS = { greenhouse, ashby, lever, workday };

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const DRY = argv.includes('--dry-run');
const AS_JSON = argv.includes('--json');
const SINCE = Number(arg('since', 0)) || 0;

const readJson = (p, fallback) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : fallback;

function log(...a) { if (!AS_JSON) console.log(...a); }

const cfg = readJson(CONFIG, null);
if (!cfg) {
  console.error(`No config at ${CONFIG}. Copy config/boards.example.json to get started.`);
  process.exit(1);
}

// Providers are hit with a small concurrency cap. Job boards are someone else's
// infrastructure and a burst of parallel requests is how you get rate limited.
async function pool(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

const targets = [];
for (const [provider, boards] of Object.entries(cfg.boards || {})) {
  if (!PROVIDERS[provider]) { log(`  skip: unknown provider "${provider}"`); continue; }
  for (const b of boards) targets.push({ provider, board: b });
}

log(`Scanning ${targets.length} boards…`);

const results = await pool(targets, 4, async ({ provider, board }) => {
  const label = typeof board === 'string' ? board : (board.company || board.tenant);
  try {
    // Workday needs search terms; the others return the whole board cheaply.
    const jobs = await PROVIDERS[provider].fetchJobs(board, {
      withContent: false,
      searchTerms: cfg.filters?.searchTerms || [],
    });
    log(`  ${provider}/${label}: ${jobs.length}`);
    return jobs;
  } catch (err) {
    // One dead board must never abort the sweep, but it must be visible: a
    // silently failing source looks identical to a source with no openings.
    log(`  ${provider}/${label}: FAILED (${err.message})`);
    return { __error: `${provider}/${label}: ${err.message}` };
  }
});

const errors = results.filter((r) => r.__error).map((r) => r.__error);
let jobs = dedupe(results.filter((r) => Array.isArray(r)).flat());
const scanned = jobs.length;

if (SINCE) jobs = newerThan(jobs, SINCE);

const kept = [];
const dropped = [];
for (const j of jobs) {
  const verdict = isUsable(j, cfg.filters || {});
  (verdict.ok ? kept : dropped).push({ ...j, _why: verdict.why, _matched: verdict.matched, _rank: verdict.rank });
}

// Only surface roles never seen before, so a repeat scan is quiet.
const seen = new Set(readJson(SEEN, []));

// A role you already applied to is not a new lead. Boards relist and repost
// constantly, and without this the same posting resurfaces after you have acted
// on it, which is how a pipeline stops being trustworthy enough to act on.
const applied = appliedCanonicals(loadApplications());

let fresh = kept.filter((j) => !seen.has(j.canonical) && !applied.has(j.canonical));

// Title matches first. The filter deliberately lets unrecognised titles through,
// so without this the handful of real hits drown in hundreds of maybes.
fresh.sort((a, b) => (a._rank ?? Infinity) - (b._rank ?? Infinity)
  || (a.company || '').localeCompare(b.company || ''));

if (argv.includes('--matched-only')) fresh = fresh.filter((j) => j._matched);

if (!DRY) {
  mkdirSync(dirname(PIPELINE), { recursive: true });
  const pipeline = readJson(PIPELINE, []);
  writeFileSync(PIPELINE, JSON.stringify([...pipeline, ...fresh.map(stripInternal)], null, 2));
  writeFileSync(SEEN, JSON.stringify([...seen, ...kept.map((j) => j.canonical)], null, 2));
}

function stripInternal(j) {
  const { _why, _matched, _rank, ...rest } = j;
  return { ...rest, rank: j._rank ?? null, matched: Boolean(j._matched),
           addedAt: new Date().toISOString(), status: 'pending' };
}

const summary = {
  boards: targets.length,
  scanned,
  afterFilters: kept.length,
  dropped: dropped.length,
  new: fresh.length,
  titleMatched: fresh.filter((j) => j._matched).length,
  errors,
  written: !DRY,
};

if (AS_JSON) { console.log(JSON.stringify({ summary, jobs: fresh.map(stripInternal) }, null, 2)); }
else {
  log(`\n${scanned} scanned, ${kept.length} passed filters, ${fresh.length} new`);
  if (fresh.length) {
    log('');
    for (const j of fresh.slice(0, 25)) {
      log(`  ${j.company.padEnd(22).slice(0, 22)} ${j.title.slice(0, 52).padEnd(52)} ${j.location.slice(0, 24)}`);
    }
    if (fresh.length > 25) log(`  … and ${fresh.length - 25} more`);
  }
  if (errors.length) log(`\n${errors.length} board(s) failed:\n  ${errors.join('\n  ')}`);
  if (DRY) log('\n(dry run, nothing written)');
}
