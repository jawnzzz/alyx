#!/usr/bin/env node
/**
 * One-time correction: restore interview stages that the old tracker lost.
 *
 * The career-ops tracker stored a single current status per row, so when an
 * application ended in a rejection the fact that it reached an on-site final
 * round stopped existing anywhere except a prose note. inbox.mjs cannot repair
 * this on its own: it correctly refuses to walk an application backwards, and
 * every one of these is a past stage on an application that has since closed.
 *
 * Each entry below cites the email or calendar invite it came from. This inserts
 * history in date order and never changes an application's current status.
 *
 * Usage: node src/backfill-history.mjs [--apply]
 */

import { load, save, find, STATUSES } from './store.mjs';

const APPLY = process.argv.includes('--apply');

const EVENTS = [
  // Sources are described, not quoted. Recruiters' names and addresses are other
  // people's personal data and have no business in a repository that is meant to
  // be public. The detail that matters here is the date and the stage.
  { company: 'CoStar',   at: '2026-07-06', status: 'interviewing', source: 'On-site final round, Arlington VA: sourcing exercise, panel interview, office tour. From calendar invites.' },
  { company: 'Lime',     at: '2026-06-17', status: 'interviewing', source: 'Interview invite via Ashby, Jun 17.' },
  { company: 'Equinox',  at: '2026-06-17', status: 'interviewing', source: 'Phone interview, then in-person interview confirmed via SmartRecruiters.' },
];

const store = load();
const changes = [];
const misses = [];

for (const ev of EVENTS) {
  const matches = find(store, ev.company);
  if (!matches?.length) { misses.push({ ...ev, reason: 'no application tracked' }); continue; }
  if (matches.length > 1) { misses.push({ ...ev, reason: `matches ${matches.length} applications` }); continue; }

  const app = matches[0];
  if (app.history.some(h => h.status === ev.status && h.at === ev.at)) {
    misses.push({ ...ev, reason: 'already recorded' });
    continue;
  }
  changes.push({ app, ev });
}

for (const { app, ev } of changes) {
  console.log(`${app.company} — ${app.role || 'role unknown'}`);
  console.log(`  insert "${ev.status}" at ${ev.at}, current status stays "${app.status}"`);
  console.log(`  source: ${ev.source}`);
  console.log('');
}
for (const m of misses) console.log(`skipped ${m.company}: ${m.reason}`);

if (APPLY) {
  for (const { app, ev } of changes) {
    app.history.push({ at: ev.at, status: ev.status, note: ev.source });
    // Keep history readable in date order; the current status is untouched.
    app.history.sort((a, b) => a.at.localeCompare(b.at));
    app.updatedAt = new Date().toISOString();
  }
  save(store);
  console.log(`\napplied ${changes.length} history corrections`);
} else {
  console.log(`\n${changes.length} corrections. Re-run with --apply to write.`);
}
