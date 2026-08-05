#!/usr/bin/env node
/**
 * ALYX evaluator. Scores pending roles against config/profile.md using the
 * Claude Code CLI, so there is no API key and no per-day quota.
 *
 * Two things this deliberately does NOT do:
 *   - it never records an API failure as a low score. An error is verdict
 *     ERROR, never FAIL, because a rate limit is not a judgement about a job.
 *   - it never writes an application anywhere. Scoring only.
 *
 * Usage:
 *   node src/evaluate.mjs                  # score every pending role
 *   node src/evaluate.mjs --limit 20
 *   node src/evaluate.mjs --matched-only   # only title-matched roles
 *   node src/evaluate.mjs --json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

import * as workday from './providers/workday.mjs';
import { stripHtml } from './normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = join(ROOT, 'config', 'profile.md');
const PIPELINE = join(ROOT, 'data', 'pipeline.json');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const LIMIT = Number(arg('limit', 25));
const AS_JSON = argv.includes('--json');
const CHECKPOINT = arg('checkpoint', join(ROOT, 'data', 'evaluations.json'));

// Claude is pinned read-only. This process writes the results itself; the model
// is never given the ability to touch the filesystem.
const CLAUDE_ARGS = ['-p', '--allowedTools', 'Read,Grep,Glob'];

// Pace requests. Even on a subscription, hammering a CLI in a tight loop is
// how a long run falls over halfway through.
const GAP_MS = Number(process.env.ALYX_GAP_MS || 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(PROFILE)) {
  console.error(`No profile at ${PROFILE}. Copy config/profile.example.md and fill it in.`);
  process.exit(1);
}
const profile = readFileSync(PROFILE, 'utf-8');
const pipeline = existsSync(PIPELINE) ? JSON.parse(readFileSync(PIPELINE, 'utf-8')) : [];

let queue = pipeline.filter((j) => j.status === 'pending');
if (argv.includes('--matched-only')) queue = queue.filter((j) => j.matched);
queue = queue.slice(0, LIMIT);

if (!queue.length) { console.log('Nothing pending to evaluate.'); process.exit(0); }
if (!AS_JSON) console.log(`Evaluating ${queue.length} roles…`);

/** Job descriptions are fetched here rather than at scan time, so a scan stays cheap. */
async function getDescription(job) {
  if (job.description) return job.description;
  if (job.source === 'workday' && job.detailUrl) {
    return workday.fetchDescription(job.detailUrl).catch(() => null);
  }
  try {
    const res = await fetch(job.url, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow' });
    if (!res.ok) return null;
    return stripHtml(await res.text())?.slice(0, 6000) || null;
  } catch { return null; }
}

function askClaude(prompt) {
  return new Promise((resolve) => {
    const child = execFile('claude', CLAUDE_ARGS, { cwd: ROOT, timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ error: (stderr || err.message || '').slice(0, 200) });
        resolve({ text: (stdout || '').trim() });
      });
    child.stdin.end(prompt);
  });
}

const results = [];
for (const [i, job] of queue.entries()) {
  const jd = await getDescription(job);

  const prompt = `Score this role against the candidate profile. Reply with STRICT JSON only,
no markdown fence, no prose:
{"verdict":"PASS"|"MARGINAL"|"FAIL","score":<1-5>,"reason":"<one sentence naming the deciding factor>"}

Rules:
- Judge only against the profile below. Do not use outside knowledge of the company.
- If the job description could not be fetched, score from title and location alone
  and say so in the reason.
- A hard requirement the candidate cannot meet is an automatic FAIL.

===== CANDIDATE PROFILE =====
${profile}

===== ROLE =====
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
${job.compensation ? `Compensation: ${job.compensation}` : ''}
URL: ${job.url}

${jd ? `===== JOB DESCRIPTION =====\n${jd.slice(0, 6000)}` : '(job description could not be fetched)'}
`;

  const r = await askClaude(prompt);
  let scored;
  if (r.error) {
    // ERROR is not FAIL. Conflating them silently discards good roles and looks
    // identical to a real rejection in the output.
    scored = { verdict: 'ERROR', score: null, reason: `evaluation error: ${r.error}` };
  } else {
    try {
      scored = JSON.parse(r.text.replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      scored = { verdict: 'ERROR', score: null, reason: 'model did not return valid JSON' };
    }
  }

  results.push({ ...job, ...scored, jdFetched: Boolean(jd), evaluatedAt: new Date().toISOString() });
  writeFileSync(CHECKPOINT, JSON.stringify(results, null, 2));   // survive interruption

  if (!AS_JSON) {
    const mark = scored.verdict === 'PASS' ? '+' : scored.verdict === 'ERROR' ? '!' : ' ';
    console.log(`  ${mark} [${String(scored.score ?? '-').padStart(3)}] ${job.company.slice(0, 20).padEnd(20)} ${job.title.slice(0, 46)}`);
  }
  if (i < queue.length - 1) await sleep(GAP_MS);
}

const tally = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
const errored = tally.ERROR || 0;

if (AS_JSON) console.log(JSON.stringify({ tally, results }, null, 2));
else {
  console.log(`\n${JSON.stringify(tally)}`);
  if (errored) console.log(`\n${errored} role(s) could not be scored. These are NOT rejections.`);
  console.log(`\nSaved to ${CHECKPOINT}`);
}
