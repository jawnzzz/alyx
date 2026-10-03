#!/usr/bin/env node
/**
 * Refuse to commit personal data.
 *
 * .gitignore is the first line of defence and it is a good one, but it protects
 * by path. It cannot help when personal data is pasted into a source comment, a
 * fixture or a README, which is exactly how two near misses happened on
 * 2026-10-02: two recruiters' work email addresses reached a committed source
 * file, and a screenshot of a real tracker sat in the repo for weeks.
 *
 * This reads what is actually staged and looks at the content. Patterns live in
 * config/secrets.json, which is itself gitignored, because a list of the things
 * you must not publish is a description of what to look for if you wanted to
 * find them.
 *
 * Usage:
 *   node scripts/check-staged.mjs           # check staged content (used by the hook)
 *   node scripts/check-staged.mjs --all     # check every tracked file
 *   node scripts/check-staged.mjs --install # install the pre-commit hook
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = join(ROOT, 'config', 'secrets.json');
const argv = process.argv.slice(2);

const git = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });

// ---------------------------------------------------------------- install

if (argv.includes('--install')) {
  const hook = join(ROOT, '.git', 'hooks', 'pre-commit');
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, `#!/bin/sh\nexec node "${join(ROOT, 'scripts', 'check-staged.mjs')}"\n`);
  chmodSync(hook, 0o755);
  console.log(`installed ${hook.replace(ROOT, '.')}`);
  process.exit(0);
}

// ---------------------------------------------------------------- rules

if (!existsSync(RULES)) {
  console.error(`No ${RULES.replace(ROOT, '.')}. Copy config/secrets.example.json and fill it in.`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(RULES, 'utf-8'));
const rules = (cfg.rules || []).map((r) => ({ ...r, re: new RegExp(r.pattern, r.flags || 'gi') }));
const allowPaths = (cfg.allowPaths || []).map((p) => new RegExp(p));

// ---------------------------------------------------------------- scan

const files = argv.includes('--all')
  ? git(['ls-files']).split('\n').filter(Boolean)
  : git(['diff', '--cached', '--name-only', '--diff-filter=ACM']).split('\n').filter(Boolean);

if (!files.length) process.exit(0);

const hits = [];
for (const f of files) {
  if (allowPaths.some((re) => re.test(f))) continue;

  let content;
  try {
    // Read the STAGED version, not what is on disk. They differ whenever
    // something was edited after `git add`, and the staged copy is what would
    // actually be committed.
    content = argv.includes('--all')
      ? readFileSync(join(ROOT, f), 'utf-8')
      : git(['show', `:${f}`]);
  } catch { continue; } // binary or deleted

  if (content.includes('\u0000')) continue; // binary

  for (const r of rules) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split('\n').length;
      // Never print the match itself. Echoing a phone number into a terminal
      // log to warn about a phone number is self-defeating.
      hits.push({ file: f, line, rule: r.name, hint: r.hint || '' });
      if (!r.re.global) break;
    }
  }
}

if (!hits.length) process.exit(0);

console.error('\nBLOCKED: personal data in what you are about to commit.\n');
const seen = new Set();
for (const h of hits) {
  const k = `${h.file}:${h.line}:${h.rule}`;
  if (seen.has(k)) continue;
  seen.add(k);
  console.error(`  ${h.file}:${h.line}  ${h.rule}${h.hint ? `  (${h.hint})` : ''}`);
}
console.error(`\n${seen.size} finding(s). Remove them, or if this is a false positive add the path to`);
console.error('allowPaths in config/secrets.json. To override once: git commit --no-verify\n');
process.exit(1);
