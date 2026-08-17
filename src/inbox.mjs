#!/usr/bin/env node
/**
 * Inbox ingest: turn email into proposed tracker updates.
 *
 * This exists because the tracker has now silently lost applications twice.
 * Both times the cause was the same: recording an application was a manual
 * step, so it only happened when someone remembered. Your inbox already knows
 * what you sent and what came back. This reads that and proposes the updates.
 *
 * Three rules it will not break:
 *
 *   1. It proposes, it does not decide. Nothing is written without --apply.
 *   2. Every proposal cites the email it came from, so a wrong guess is
 *      visible rather than silently authoritative.
 *   3. Classification is deterministic. No model is involved in deciding that
 *      "we are moving forward with other candidates" is a rejection, because a
 *      model that is wrong 2% of the time on 600 emails is wrong 12 times and
 *      you will not know which.
 *
 * ALYX takes no API keys and holds no accounts, so this does not talk to Gmail
 * itself. It reads an export you provide:
 *
 *   data/inbox.json  =  [{ id, date, from, subject, snippet }, ...]
 *
 * Usage:
 *   node src/inbox.mjs                # show proposals, write nothing
 *   node src/inbox.mjs --apply        # apply them
 *   node src/inbox.mjs --new-only     # only propose applications not yet tracked
 *   node src/inbox.mjs --json
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { load, save, makeApplication, setStatus, STATUSES } from './store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = join(ROOT, 'data', 'inbox.json');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const AS_JSON = argv.includes('--json');
const NEW_ONLY = argv.includes('--new-only');
const log = (...a) => { if (!AS_JSON) console.log(...a); };

if (!existsSync(INBOX)) {
  console.error(`No inbox export at ${INBOX}.`);
  console.error('Expected: [{ id, date, from, subject, snippet }, ...]');
  process.exit(1);
}

const emails = JSON.parse(readFileSync(INBOX, 'utf-8'));

/**
 * Ordered most-decisive first. A rejection frequently opens with "thank you for
 * your interest", which is also how a confirmation opens, so whichever pattern
 * is checked first wins. Rejection has to come before confirmation or every
 * rejection in the mailbox reads as a fresh application.
 */
const CLASSIFIERS = [
  ['offer',        /\b(pleased to offer|offer letter|we would like to offer|extend an offer)\b/i],
  ['rejected',     /\b(unfortunately|not moving forward|other candidates|another direction|decided to move forward with|will not be moving|regret to inform|not selected|no longer under consideration)\b/i],
  ['interviewing', /\b(interview|phone screen|schedule a (time|call|chat)|set up a time|next steps|your availability|meeting is scheduled|invites you to a meeting)\b/i],
  ['assessment',   /\b(assessment|take-home|coding (test|challenge)|short exercise|complete a (short|brief))\b/i],
  ['applied',      /\b(thank you for (applying|your application)|we('ve| have) received your application|your application was (sent|submitted|received)|application has been received|thanks for (applying|your application))\b/i],
];

function classify(email) {
  const hay = `${email.subject || ''} ${email.snippet || ''}`;
  for (const [kind, re] of CLASSIFIERS) if (re.test(hay)) return kind;
  return null;
}

/** An assessment is progress but is not one of the tracker's states. Treat it
 *  as engagement, which is what it is, and keep the detail in the note. */
const TO_STATUS = { offer: 'offer', rejected: 'rejected', interviewing: 'interviewing', assessment: 'responded', applied: 'applied' };

/** Noise that never carries a company name worth matching. */
const IGNORE_SENDERS = /(capitalone|strava|twitch|eventbrite|ea\.com|linkedin\.com\/comm|no-reply@rippling)/i;

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Split into whole words. Substring matching is not safe here: "Employ"
 *  contains "Ploy", and "Personal Trainer" contains "Rain". The first dry run
 *  of this file proposed rejecting a real application at Ploy on the strength
 *  of an email from Employ, which is precisely the kind of confident, wrong
 *  write this tool exists to avoid. */
const words = (s) => normalize(s).split(' ').filter(Boolean);

function hasPhrase(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Find the application an email belongs to. The company name appearing as
 * whole words in the subject or body is the strongest signal available in an
 * export with no thread linkage; the sender domain is the fallback. Anything
 * ambiguous is reported rather than guessed, because a status written against
 * the wrong company is worse than one not written at all.
 */
function matchApplication(email, apps) {
  const hay = words(`${email.subject} ${email.snippet}`);
  const domain = ((email.from || '').split('@')[1] || '').toLowerCase();

  const hits = apps.filter((a) => {
    const needle = words(a.company);
    if (!needle.length || needle.join('').length < 3) return false;
    if (hasPhrase(hay, needle)) return true;
    // Domain match must be a whole label, so "rain" never matches "trainer.com".
    const squashed = needle.join('');
    return domain.split('.').some((label) => label === squashed);
  });

  return hits.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

/**
 * Pull a company name out of an email that matched nothing tracked. Ordered
 * most-specific first: "applying to X" is a far better signal than "at X",
 * which happily matches "Manager, Talent Solutions at LinkedIn" from the wrong
 * end if it runs first.
 */
const WORD = "[A-Z][\\w&'-]*(?:\\.[A-Za-z][\\w&'-]*)*";
const NAME = `${WORD}(?:[ ]${WORD}){0,3}`;

const NAME_PATTERNS = [
  new RegExp(`(?:thanks?(?: you)? for )?apply(?:ing)?(?: to| for| with)\\s+(${NAME})`),
  new RegExp(`application (?:to|at|with)\\s+(${NAME})`),
  new RegExp(`(?:interest in|opportunit(?:y|ies) with|joining)\\s+(${NAME})`),
  new RegExp(`\\bat\\s+(${NAME})`),
];

const NAME_STOPWORDS = /^(the|our|your|this|we|us|a|an)$/i;
const TRAILING_NOISE = /\s+(inc|llc|ltd|group|co|corp)\.?$/i;

/** Words that routinely trail a company name in a subject line and are never
 *  part of it. Trimmed from the end, repeatedly, so "FXC Intelligence Interview
 *  Invite" resolves to "FXC Intelligence". */
const TRAILING_WORDS = /\s+(interview|invite|invitation|application|applications|update|opportunity|opportunities|careers?|team|position|role|status|confirmation|reminder|follow)$/i;

function guessCompany(email) {
  for (const text of [email.subject || '', email.snippet || '']) {
    for (const re of NAME_PATTERNS) {
      const m = text.match(re);
      if (!m) continue;
      let name = m[1].trim().replace(/[.,!|:;]+$/, '');
      if (NAME_STOPWORDS.test(name.split(' ')[0])) continue;
      name = name.replace(TRAILING_NOISE, '');
      while (TRAILING_WORDS.test(name)) name = name.replace(TRAILING_WORDS, '');
      if (name.length > 1) return name;
    }
  }

  const domain = ((email.from || '').split('@')[1] || '').toLowerCase();
  const host = domain.replace(/^(mail|no-reply|noreply|notifications?|jobs|careers|hire|apply|candidates)\./, '').split('.')[0];
  const GENERIC = new Set(['greenhouse', 'us', 'lever', 'ashbyhq', 'myworkday', 'smartrecruiters',
    'gmail', 'linkedin', 'applytojob', 'teamtailor', 'mindbodyonline', 'workablemail', 'e', 'k2services']);
  if (GENERIC.has(host)) return null;
  return host.charAt(0).toUpperCase() + host.slice(1);
}

const store = load();
const apps = store.applications;

const proposals = [];
const unmatched = [];
const ignored = [];

for (const email of emails) {
  if (IGNORE_SENDERS.test(email.from || '')) { ignored.push(email); continue; }

  const kind = classify(email);
  if (!kind) { ignored.push(email); continue; }

  const status = TO_STATUS[kind];
  const date = (email.date || '').slice(0, 10);
  const matches = matchApplication(email, apps);

  if (!matches.length) {
    const company = guessCompany(email);
    if (!company) { unmatched.push({ email, reason: 'no company could be identified' }); continue; }
    // Only a confirmation proves an application exists. A rejection from a
    // company with no tracked application still implies one was sent, so it
    // creates the record and lands on the rejected status in one step.
    proposals.push({ type: 'create', company, status, date, email, kind });
    continue;
  }

  if (NEW_ONLY) continue;

  const app = matches[0];
  if (matches.length > 1) {
    unmatched.push({ email, reason: `matches ${matches.length} applications at ${app.company}, needs a human` });
    continue;
  }

  // Never propose a change that is not a change, and never walk an application
  // backwards. An "application received" auto-reply that arrives after an
  // interview was booked must not reset the record to applied.
  const now = STATUSES.indexOf(app.status);
  const next = STATUSES.indexOf(status);
  if (app.status === status) continue;
  // A hire is the end of the story. A welcome letter that reads as an offer
  // must not walk an accepted role back a step.
  if (app.status === 'hired') continue;
  if (next < now && !['rejected', 'offer'].includes(status)) continue;

  proposals.push({ type: 'update', app, status, date, email, kind });
}

// ---------------------------------------------------------------- output

if (AS_JSON) {
  console.log(JSON.stringify({
    proposals: proposals.map(p => ({
      type: p.type, company: p.type === 'create' ? p.company : p.app.company,
      role: p.type === 'update' ? p.app.role : null,
      from: p.type === 'update' ? p.app.status : null,
      to: p.status, date: p.date, kind: p.kind,
      source: { subject: p.email.subject, from: p.email.from, date: p.email.date },
    })),
    unmatched: unmatched.map(u => ({ subject: u.email.subject, from: u.email.from, reason: u.reason })),
    counts: { emails: emails.length, proposals: proposals.length, unmatched: unmatched.length, ignored: ignored.length },
  }, null, 2));
} else {
  const creates = proposals.filter(p => p.type === 'create');
  const updates = proposals.filter(p => p.type === 'update');

  if (updates.length) {
    log(`\nSTATUS CHANGES (${updates.length})\n`);
    for (const p of updates) {
      log(`  ${p.app.company} — ${p.app.role || 'role unknown'}`);
      log(`    ${p.app.status} -> ${p.status}   ${p.date}`);
      log(`    from: "${(p.email.subject || '').slice(0, 78)}"`);
      log('');
    }
  }

  if (creates.length) {
    log(`\nAPPLICATIONS NOT YET TRACKED (${creates.length})\n`);
    for (const p of creates) {
      log(`  ${p.company}   ${p.status}   ${p.date}`);
      log(`    from: "${(p.email.subject || '').slice(0, 78)}"`);
      log('');
    }
  }

  if (unmatched.length) {
    log(`\nNEEDS A HUMAN (${unmatched.length})\n`);
    for (const u of unmatched) log(`  ${u.reason}\n    "${(u.email.subject || '').slice(0, 78)}"`);
    log('');
  }

  log(`${emails.length} emails read, ${ignored.length} ignored as noise`);
  log(APPLY ? `applying ${proposals.length} changes` : `${proposals.length} proposals. Re-run with --apply to write.`);
}

if (APPLY) {
  for (const p of proposals) {
    if (p.type === 'create') {
      const app = makeApplication({
        company: p.company, role: null, appliedAt: p.date,
        status: p.status === 'rejected' ? 'applied' : p.status,
        note: `found in inbox: "${p.email.subject}"`,
      });
      // A rejection implies the application preceded it, so record both steps
      // rather than collapsing the history into its outcome.
      if (p.status === 'rejected') setStatus(app, 'rejected', { at: p.date, note: `"${p.email.subject}"` });
      store.applications.push(app);
    } else {
      setStatus(p.app, p.status, { at: p.date, note: `inbox: "${p.email.subject}"` });
    }
  }
  save(store);
}
