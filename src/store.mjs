/**
 * The application record store: data/applications.json.
 *
 * This is the file that answers "what did I send, when, and what happened."
 * The tracker it replaces lost 46 of 53 applications and had to be rebuilt from
 * Gmail, so two properties matter more than convenience here:
 *
 *   1. History is append-only. A status change never destroys the status it
 *      replaced. Reconstructing a funnel from a file that only knows the
 *      current state is guesswork.
 *   2. Writes are atomic. A half-written applications.json during a crash is
 *      exactly the silent data loss this store exists to prevent.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import { canonicalUrl } from './normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STORE_PATH = join(ROOT, 'data', 'applications.json');

/** Ordered by how far through a hiring process they are. Order is meaningful:
 *  `stats` reports the funnel in this sequence, and it is how "furthest state
 *  reached" is computed from history. */
export const STATUSES = ['applied', 'responded', 'interviewing', 'offer', 'hired', 'rejected', 'withdrawn'];

/** Statuses that mean the process is over, one way or another. */
export const TERMINAL = new Set(['hired', 'rejected', 'withdrawn']);

/** Lanes exist because one hire in a lane you are not targeting will otherwise
 *  make a broken funnel look solved. Keep them separable, not merged. */
export const LANES = ['career', 'other'];

const empty = () => ({ version: 1, applications: [] });

export function load(path = STORE_PATH) {
  if (!existsSync(path)) return empty();
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return empty();

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Hand-editing this file is a supported recovery path, so a syntax error is
    // a likely human typo. Refuse to continue rather than overwrite their edit
    // with an empty store.
    throw new Error(`applications.json is not valid JSON (${e.message}). Fix it or move it aside; ALYX will not overwrite it.`);
  }

  if (!Array.isArray(data.applications)) throw new Error('applications.json has no "applications" array.');
  return data;
}

/** Write via a temp file and rename, so a reader never sees a partial store. */
export function save(data, path = STORE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

/**
 * Stable id. A canonical URL is the best key we have, since two records for the
 * same posting must collide. Without one, fall back to company+role+date, which
 * is what backfilled rows from an email confirmation can offer.
 *
 * Deliberately not a sequence number: the tracker being migrated used one, and
 * its numbers collided (rows run 76, 77, 78, 30, 31) after a backfill.
 */
export function makeId({ canonical, url, company, role, appliedAt }) {
  const basis = canonical || (url ? canonicalUrl(url) : null) || [company, role, appliedAt].join('|');
  return createHash('sha1').update(String(basis).toLowerCase()).digest('hex').slice(0, 10);
}

export function find(data, selector) {
  if (!selector) return null;
  const needle = String(selector).toLowerCase();

  // Exact id first, then id prefix, then company name. Ambiguity is reported by
  // the caller rather than silently resolved to whichever matched first.
  const byId = data.applications.filter(a => a.id === needle);
  if (byId.length) return byId;

  const byPrefix = data.applications.filter(a => a.id.startsWith(needle));
  if (byPrefix.length) return byPrefix;

  return data.applications.filter(a => a.company.toLowerCase().includes(needle));
}

/**
 * Create a record. `at` is injected rather than read from the clock so the
 * migration can stamp each row with its real application date instead of today.
 */
export function makeApplication({
  company, role, url = null, source = null, appliedAt,
  status = 'applied', lane = 'career', score = null, verdict = null, note = null,
}) {
  if (!company) throw new Error('an application needs a company');
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}" (expected: ${STATUSES.join(', ')})`);
  if (!LANES.includes(lane)) throw new Error(`unknown lane "${lane}" (expected: ${LANES.join(', ')})`);

  const canonical = url ? canonicalUrl(url) : null;
  const at = appliedAt || new Date().toISOString().slice(0, 10);

  return {
    id: makeId({ canonical, url, company, role, appliedAt: at }),
    company,
    role: role || null,
    url: url || null,
    canonical,
    source,
    lane,
    appliedAt: at,
    status,
    score,
    verdict,
    history: [{ at, status, note: note || null }],
    notes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Move an application to a new status, appending to history. Returns the
 *  record, or throws if the status is unknown. A no-op repeat of the current
 *  status still records, since "they said no again" is real information. */
export function setStatus(app, status, { note = null, at = null } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}" (expected: ${STATUSES.join(', ')})`);
  const stamp = at || new Date().toISOString().slice(0, 10);
  app.history.push({ at: stamp, status, note: note || null });
  app.status = status;
  app.updatedAt = new Date().toISOString();
  return app;
}

export function addNote(app, text) {
  app.notes.push({ at: new Date().toISOString().slice(0, 10), text });
  app.updatedAt = new Date().toISOString();
  return app;
}

/** The furthest point this application ever reached, which is not the same as
 *  its current status: a rejection after an interview should still count as an
 *  interview in the funnel. Conflating them is how a funnel understates itself. */
export function furthest(app) {
  const reached = app.history.map(h => STATUSES.indexOf(h.status)).filter(i => i >= 0);
  // Terminal states are outcomes, not progress, so they never count as "furthest".
  const progress = reached.filter(i => !TERMINAL.has(STATUSES[i]));
  return STATUSES[Math.max(...(progress.length ? progress : reached), 0)];
}

/** Days since this record last moved. Used to surface applications gone quiet. */
export function daysSince(app, today = new Date()) {
  const last = app.history[app.history.length - 1]?.at || app.appliedAt;
  const ms = today - new Date(`${last}T00:00:00Z`);
  return Math.floor(ms / 86400000);
}

/** Canonical URLs with an application against them. The scanner uses this to
 *  stop resurfacing roles already applied to. */
export function appliedCanonicals(data) {
  return new Set(data.applications.map(a => a.canonical).filter(Boolean));
}
