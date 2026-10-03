#!/usr/bin/env node
/**
 * Back up the files that are deliberately not in the public repository.
 *
 * ALYX's whole premise is that a job search history is worth keeping, and this
 * tracker has already been rebuilt from old email twice. It currently exists on
 * exactly one machine with no copy anywhere, which is the same failure in a
 * different shape.
 *
 * This copies the private files into a sibling repository you push to a PRIVATE
 * remote. Version history on the tracker is the point as much as the offsite
 * copy: when an import goes wrong, you want to see what changed and roll it
 * back, not reconstruct it again.
 *
 * Usage:
 *   node src/backup.mjs                 # copy, commit, push
 *   node src/backup.mjs --no-push       # copy and commit only
 *   node src/backup.mjs --status        # what would be copied, and whether it changed
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = join(dirname(ROOT), 'alyx-private');

const argv = process.argv.slice(2);
const STATUS_ONLY = argv.includes('--status');
const NO_PUSH = argv.includes('--no-push');

/** Exactly the files the public repository gitignores. Kept as an explicit list
 *  rather than read from .gitignore: a backup that silently changes what it
 *  covers because a pattern changed is a backup you cannot trust. */
const FILES = [
  'data/applications.json',
  'config/applicant.json',
  'config/profile.md',
  'config/boards.json',
  'config/resumes.json',
  'STATUS.md',
  'src/backfill-history.mjs',
];

const git = (args, cwd = VAULT) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const present = FILES.filter((f) => existsSync(join(ROOT, f)));
const missing = FILES.filter((f) => !existsSync(join(ROOT, f)));

if (STATUS_ONLY) {
  console.log(`vault: ${VAULT}${existsSync(VAULT) ? '' : '  (not created yet)'}`);
  for (const f of present) {
    const src = statSync(join(ROOT, f));
    const dstPath = join(VAULT, f);
    const state = !existsSync(dstPath) ? 'NEW'
      : statSync(dstPath).mtime < src.mtime ? 'CHANGED' : 'current';
    console.log(`  ${state.padEnd(8)} ${f}`);
  }
  for (const f of missing) console.log(`  absent   ${f}`);
  process.exit(0);
}

// Set the vault up on first run. It is created with a .gitignore of its own and
// a README saying what it is, because an unlabelled folder of personal data is
// the kind of thing that gets published by accident later.
if (!existsSync(join(VAULT, '.git'))) {
  mkdirSync(VAULT, { recursive: true });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(VAULT, 'README.md'),
    '# alyx-private\n\n' +
    'Personal data for ALYX: the tracker, the applicant profile, targeting and\n' +
    'board configuration. **This repository must stay private.** It is the data the\n' +
    'public repo at https://github.com/jawnzzz/alyx deliberately gitignores.\n\n' +
    'Written by `node src/backup.mjs` in the ALYX checkout. Do not edit here; edit\n' +
    'in ALYX and run the backup again.\n');
  writeFileSync(join(VAULT, '.gitignore'), '.DS_Store\n*.tmp\n');
  console.log(`created ${VAULT}`);
}

for (const f of present) {
  const dst = join(VAULT, f);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(ROOT, f), dst);
}

git(['add', '-A']);
const pending = git(['status', '--porcelain']);
if (!pending) {
  console.log('nothing changed since the last backup');
  process.exit(0);
}

// The message carries the one number worth seeing in a log: how many
// applications were in the tracker at that moment.
let count = '?';
try {
  count = String(JSON.parse(readFileSync(join(ROOT, 'data/applications.json'), 'utf-8')).applications.length);
} catch { /* a missing or unreadable store should not stop the backup */ }

const changed = pending.split('\n').map((l) => basename(l.slice(3))).join(', ');
git(['commit', '-q', '-m', `backup: ${count} applications (${changed})`]);
console.log(`committed: ${count} applications, changed: ${changed}`);

if (NO_PUSH) process.exit(0);

let remote = '';
try { remote = git(['remote', 'get-url', 'origin']); } catch { /* none set */ }

if (!remote) {
  console.log('\nNo remote yet. Create a PRIVATE repo, then:');
  console.log(`  cd ${VAULT}`);
  console.log('  git remote add origin git@github.com:<you>/alyx-private.git');
  console.log('  git push -u origin main');
  console.log('\nMake sure it is private. This is your job search.');
  process.exit(0);
}

git(['push', '-q', 'origin', 'main']);
console.log(`pushed to ${remote}`);
