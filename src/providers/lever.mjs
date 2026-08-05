/**
 * Lever job board provider.
 *
 * Public endpoint, no auth:
 *   https://api.lever.co/v0/postings/{org}?mode=json
 *
 * Returns a bare ARRAY (not an object), each entry:
 *   { id, text, hostedUrl, applyUrl, createdAt, categories: {location, team, commitment},
 *     descriptionPlain, additionalPlain }
 * Note `text` is the title and `createdAt` is epoch millis.
 */

import { normalizeJob } from '../normalize.mjs';

export const id = 'lever';

export async function fetchJobs(org, { withContent = false, signal } = {}) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(org)}?mode=json`;

  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`lever ${org}: HTTP ${res.status}`);

  const body = await res.json();
  // Lever returns a top-level array; anything else means the org slug is wrong
  // and we got an error object back.
  if (!Array.isArray(body)) throw new Error(`lever ${org}: unexpected response shape`);

  return body.map((j) => normalizeJob({
    source: id,
    company: org,
    id: String(j.id),
    title: j.text,
    url: j.hostedUrl || j.applyUrl,
    location: j.categories?.location || '',
    team: j.categories?.team || null,
    employmentType: j.categories?.commitment || null,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: withContent
      ? [j.descriptionPlain, j.additionalPlain].filter(Boolean).join('\n\n') || null
      : null,
  }));
}
