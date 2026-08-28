#!/usr/bin/env node
/**
 * Smoke test for the autofill field map.
 *
 * The standing maintenance cost of assisted apply is that ATS vendors change
 * their forms without telling anyone, and a fill that silently stops filling
 * one field looks exactly like a fill that worked. This is the thing that
 * notices. Run it on a schedule and a broken selector surfaces here rather than
 * halfway through an application.
 *
 * It checks the anchors the extension actually relies on, in the same order:
 * autocomplete tokens first, then ids, then label text.
 *
 * Usage:
 *   node src/canary.mjs
 *   node src/canary.mjs --json
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = JSON.parse(readFileSync(join(ROOT, 'extension', 'fields.json'), 'utf-8'));
const AS_JSON = process.argv.includes('--json');

/**
 * Known-live postings, one per vendor. These go stale: a posting that closes
 * makes the canary report a false alarm, which is why a fetch failure is
 * reported as STALE and not as a broken field map. Update them when they close.
 */
const SAMPLES = [
  { vendor: 'greenhouse', url: 'https://job-boards.greenhouse.io/doordashusa/jobs/8052772' },
];

/** The anchors we expect to find in the served HTML for the universal fields.
 *  Only fields every application form asks for; optional ones would produce
 *  noise, and noise is how a canary gets ignored. */
const REQUIRED = ['identity.firstName', 'identity.lastName', 'identity.email'];

async function check({ vendor, url }) {
  let html;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (ALYX canary)' }, redirect: 'follow' });
    if (!res.ok) return { vendor, url, status: 'STALE', detail: `HTTP ${res.status}` };
    html = await res.text();
  } catch (e) {
    return { vendor, url, status: 'UNREACHABLE', detail: e.message };
  }

  // A closed posting redirects to the board index, which has no application
  // form at all. That is a stale sample, not a broken map, and conflating the
  // two is how a canary trains you to ignore it.
  if (!/type=["']?file|resume|application/i.test(html)) {
    return { vendor, url, status: 'STALE', detail: 'no application form on the page' };
  }

  const results = [];
  for (const spec of MAP.fields) {
    const anchors = [
      ...(spec.autocomplete || []).map(t => ({ via: `autocomplete=${t}`, re: new RegExp(`autocomplete=["']${t}["']`, 'i') })),
      ...(spec.id || []).map(i => ({ via: `id=${i}`, re: new RegExp(`id=["']${i}["']`, 'i') })),
      ...(spec.label || []).map(l => ({ via: `label~"${l}"`, re: new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })),
    ];
    const hit = anchors.find(a => a.re.test(html));
    results.push({ key: spec.key, found: Boolean(hit), via: hit?.via || null });
  }

  const broken = results.filter(r => REQUIRED.includes(r.key) && !r.found);
  return {
    vendor, url,
    status: broken.length ? 'BROKEN' : 'OK',
    resolved: `${results.filter(r => r.found).length}/${results.length}`,
    broken: broken.map(b => b.key),
    fields: results,
  };
}

const report = [];
for (const s of SAMPLES) report.push(await check(s));

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of report) {
    console.log(`${r.status.padEnd(11)} ${r.vendor.padEnd(12)} ${r.resolved || ''} ${r.detail || ''}`);
    if (r.status === 'BROKEN') for (const b of r.broken) console.log(`            missing anchor: ${b}`);
    if (r.status === 'STALE') console.log(`            sample posting closed. Update SAMPLES in src/canary.mjs.`);
  }
}

// Non-zero exit on a real break, so a scheduled run can alert rather than
// scrolling past in a log nobody reads.
process.exit(report.some(r => r.status === 'BROKEN') ? 1 : 0);
