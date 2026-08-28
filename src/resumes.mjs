/**
 * The resume registry.
 *
 * Reads the resume library on disk rather than a config listing it, because a
 * config would go stale the first time a new resume is saved and nobody
 * remembers to update it. Staleness through manual upkeep is the failure this
 * whole project keeps fixing.
 *
 * Three folders, three different jobs:
 *
 *   WORKING RESUMES   the base variants. These are what a tailored resume
 *                     should be built from.
 *   Career Ops ...    general-purpose recruiting and CS versions.
 *   ARCHIVE ...       what actually went out. Read-only history, never a
 *                     candidate for a new application.
 *
 * Most variants exist twice, with and without the Joiner Jobs entry. That is a
 * real experimental variable, so it is recorded rather than flattened away.
 */

import { readdirSync, existsSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';

const DESK = join(homedir(), 'Desktop', 'LINDSEY RESUMES');

export const LIBRARY = [
  { dir: join(DESK, 'WORKING RESUMES'), kind: 'working' },
  { dir: join(DESK, 'Career Ops Resumes, General (Recruiting and Customer Success)'), kind: 'general' },
  { dir: join(DESK, 'ARCHIVE - Submitted Resumes'), kind: 'archive' },
];

/**
 * Lane and variant, inferred from the filename.
 *
 * Order matters. The letter-prefixed variants (A/B/C) are checked before the
 * generic words they also contain, so "C GTM TECH" is variant C rather than
 * falling through to a keyword guess.
 */
const VARIANTS = [
  { id: 'high-volume-ops', lane: 'career', match: /\bA HIGH VOLUME OPS\b/i,               label: 'A, high volume ops' },
  { id: 'corporate-legal', lane: 'career', match: /\bB CORPORATE LEGAL\b/i,               label: 'B, corporate legal' },
  { id: 'gtm-tech',        lane: 'career', match: /\bC GTM TECH\b/i,                      label: 'C, GTM tech' },
  { id: 'technical-rec',   lane: 'career', match: /Technical Recruiter/i,                 label: 'technical recruiter' },
  { id: 'recruiting',      lane: 'career', match: /Recruiting Resume/i,                   label: 'recruiting, general' },
  { id: 'cs-ops',          lane: 'career', match: /CS OPS|cv-cs/i,                        label: 'customer success / ops' },
];

function classify(file) {
  const name = basename(file, extname(file));
  const variant = VARIANTS.find(v => v.match.test(name));
  return {
    variant: variant?.id || 'unclassified',
    variantLabel: variant?.label || null,
    // She maintains twins of most variants, one listing Joiner Jobs and one not.
    // Whether that entry helps or hurts is answerable only if it is recorded.
    joinerJobs: !/\(no Joiner Jobs\)/i.test(name),
  };
}

export function catalogue() {
  const out = [];
  for (const { dir, kind } of LIBRARY) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      // Word lock files start with ~$ and are not resumes.
      if (f.startsWith('.') || f.startsWith('~$')) continue;
      if (!/\.(docx|pdf)$/i.test(f)) continue;
      const path = join(dir, f);
      out.push({
        name: basename(f, extname(f)),
        file: f,
        path,
        kind,
        format: extname(f).slice(1).toLowerCase(),
        ...classify(f),
        modified: statSync(path).mtime.toISOString().slice(0, 10),
      });
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** Candidates for a new application. The archive is history, never a choice. */
export function selectable() {
  return catalogue().filter(r => r.kind !== 'archive');
}
