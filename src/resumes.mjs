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
 * Variants often exist in near-duplicate pairs, differing by one optional entry
 * someone is unsure about including. Those differences are recorded as tags
 * rather than flattened away, because whether that entry helps or hurts is only
 * answerable if the choice is stored next to the outcome.
 *
 * The library location is configured, not assumed. Paths come from
 * config/resumes.json; see config/resumes.example.json.
 */

import { readdirSync, existsSync, statSync, readFileSync } from 'fs';
import { join, basename, extname, dirname, isAbsolute } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'config', 'resumes.json');

const expand = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

/** Where the resumes live. Absent config means an empty library rather than a
 *  crash: the rest of ALYX works fine without one. */
export function library() {
  if (!existsSync(CONFIG)) return [];
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf-8'));
  return (cfg.folders || []).map((f) => ({
    dir: isAbsolute(expand(f.path)) ? expand(f.path) : join(ROOT, f.path),
    kind: f.kind || 'working',
  }));
}

/**
 * Lane and variant, inferred from the filename.
 *
 * Order matters. The letter-prefixed variants (A/B/C) are checked before the
 * generic words they also contain, so "C GTM TECH" is variant C rather than
 * falling through to a keyword guess.
 */
/** Variant patterns come from config too, since what counts as a variant is
 *  entirely personal. Order matters: the first pattern a filename matches wins,
 *  so put the specific ones before the generic. */
function variants() {
  if (!existsSync(CONFIG)) return [];
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf-8'));
  return (cfg.variants || []).map(v => ({ ...v, match: new RegExp(v.match, 'i') }));
}

function classify(file, vs, tagRules) {
  const name = basename(file, extname(file));
  const variant = vs.find(v => v.match.test(name));
  // Tags capture the near-duplicate pairs: a filename marked with the absence
  // of an optional entry gets the tag dropped, so the outcome can later be
  // compared against the choice.
  const tags = tagRules.filter(t => new RegExp(t.match, 'i').test(name) !== Boolean(t.absent)).map(t => t.id);
  return { variant: variant?.id || 'unclassified', variantLabel: variant?.label || null, tags };
}

export function catalogue() {
  const out = [];
  const vs = variants();
  const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf-8')) : {};
  const tagRules = cfg.tags || [];
  for (const { dir, kind } of library()) {
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
        ...classify(f, vs, tagRules),
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
