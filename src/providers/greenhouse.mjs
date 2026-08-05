/**
 * Greenhouse job board provider.
 *
 * Public endpoint, no auth:
 *   https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
 *
 * Returns { jobs: [{ id, title, absolute_url, location: {name}, updated_at, content }] }
 * `content` is HTML-escaped HTML, so it needs unescaping before tag stripping.
 */

import { stripHtml, normalizeJob } from '../normalize.mjs';

export const id = 'greenhouse';

export async function fetchJobs(board, { withContent = false, signal } = {}) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`
    + (withContent ? '?content=true' : '');

  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`greenhouse ${board}: HTTP ${res.status}`);

  const body = await res.json();
  return (body.jobs || []).map((j) => normalizeJob({
    source: id,
    company: board,
    id: String(j.id),
    title: j.title,
    url: j.absolute_url,
    // location is an object here, and is frequently the string "Remote" rather
    // than a real place, which the location filter has to cope with.
    location: j.location?.name || '',
    postedAt: j.updated_at || j.first_published || null,
    description: withContent && j.content ? stripHtml(j.content) : null,
  }));
}
