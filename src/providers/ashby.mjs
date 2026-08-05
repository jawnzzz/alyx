/**
 * Ashby job board provider.
 *
 * Public endpoint, no auth:
 *   https://api.ashbyhq.com/posting-api/job-board/{org}
 *   add ?includeCompensation=true to get the pay range where the org publishes one
 *
 * Returns { jobs: [{ id, title, jobUrl, location, secondaryLocations,
 *                    employmentType, publishedAt, descriptionPlain, compensation }] }
 * Unlike Greenhouse, descriptionPlain is already plain text.
 */

import { normalizeJob } from '../normalize.mjs';

export const id = 'ashby';

export async function fetchJobs(org, { withContent = false, signal } = {}) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`
    + '?includeCompensation=true';

  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ashby ${org}: HTTP ${res.status}`);

  const body = await res.json();
  return (body.jobs || []).map((j) => {
    // Ashby splits locations: one primary plus an array. A role open in several
    // places reads as a single job, so join them or a US role listed second
    // gets filtered out by a naive location match.
    const locs = [j.location, ...(j.secondaryLocations || []).map((s) => s?.location || s)]
      .filter(Boolean);

    return normalizeJob({
      source: id,
      company: org,
      id: String(j.id),
      title: j.title,
      url: j.jobUrl || j.applyUrl,
      location: [...new Set(locs)].join(' | '),
      postedAt: j.publishedAt || null,
      employmentType: j.employmentType || null,
      compensation: j.compensation?.compensationTierSummary || null,
      description: withContent ? (j.descriptionPlain || null) : null,
    });
  });
}
