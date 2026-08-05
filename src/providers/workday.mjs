/**
 * Workday (CXS) job board provider.
 *
 * Workday is the awkward one. Listing is a POST, not a GET:
 *   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 *   body: { appliedFacets: {}, limit, offset, searchText }
 *   -> { total, jobPostings: [{ title, externalPath, locationsText, postedOn, bulletFields }] }
 *
 * The listing carries no description and no absolute URL. `externalPath` is a
 * path fragment that has to be joined two different ways:
 *   - human URL:  https://{host}/{site}{externalPath}
 *   - detail API: https://{host}/wday/cxs/{tenant}/{site}{externalPath}
 *
 * `postedOn` is a human string ("Posted 2 Days Ago"), never a date, so it is
 * parsed to an approximate ISO date rather than trusted as exact.
 * `bulletFields[0]` is usually the requisition ID, which is the only stable
 * way to tell two same-titled postings apart.
 */

import { stripHtml, normalizeJob } from '../normalize.mjs';

export const id = 'workday';

// "Posted 2 Days Ago" / "Posted 30+ Days Ago" / "Posted Today" / "Posted Yesterday"
function parsePostedOn(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const now = Date.now();
  const day = 86400000;
  if (t.includes('today')) return new Date(now).toISOString();
  if (t.includes('yesterday')) return new Date(now - day).toISOString();
  const m = /(\d+)\+?\s*(day|week|month)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1;
  return new Date(now - n * mult * day).toISOString();
}

/**
 * @param {object} site  { host, tenant, site, company }
 *   e.g. { host: 'stryker.wd1.myworkdayjobs.com', tenant: 'stryker',
 *          site: 'StrykerCareers', company: 'Stryker' }
 */
export async function fetchJobs(site, { withContent = false, searchTerms = [], limit = 100, signal } = {}) {
  const { host, tenant, site: board, company } = site;
  const base = `https://${host}/wday/cxs/${tenant}/${board}`;

  // Workday must be SEARCHED, not crawled. With an empty searchText a large
  // tenant returns its entire global board (thousands of roles, mostly other
  // countries), so anything you actually want sits far past any sane page
  // limit. One query per search term, merged, is both faster and far more
  // relevant. Falling back to '' is only for tiny boards.
  const terms = searchTerms.length ? searchTerms : [''];
  const byId = new Map();

  for (const term of terms) {
    for (let offset = 0; offset < limit; offset += 20) {
      const res = await fetch(`${base}/jobs`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: term }),
      });
      if (!res.ok) throw new Error(`workday ${tenant}: HTTP ${res.status}`);

      const body = await res.json();
      const page = body.jobPostings || [];
      if (!page.length) break;

      for (const j of page) {
        const key = j.externalPath;
        if (byId.has(key)) continue;      // same role can match several terms
        byId.set(key, normalizeJob({
          source: id,
          company: company || tenant,
          id: j.bulletFields?.[0] || j.externalPath,
          reqId: j.bulletFields?.[0] || null,
          title: j.title,
          url: `https://${host}/${board}${j.externalPath}`,
          detailUrl: `${base}${j.externalPath}`,
          location: j.locationsText || '',
          postedAt: parsePostedOn(j.postedOn),
          postedApproximate: true,
          description: null,
        }));
      }
      // Stop once this term is exhausted, not once the merged set is big.
      if (offset + 20 >= (body.total || 0)) break;
    }
  }

  const out = [...byId.values()];

  if (withContent) {
    for (const job of out) {
      try { job.description = await fetchDescription(job.detailUrl, { signal }); }
      catch { job.description = null; }
    }
  }
  return out.slice(0, limit);
}

/** Job detail lives at the CXS path and returns HTML in jobPostingInfo.jobDescription. */
export async function fetchDescription(detailUrl, { signal } = {}) {
  const res = await fetch(detailUrl, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const body = await res.json();
  const html = body?.jobPostingInfo?.jobDescription;
  return html ? stripHtml(html) : null;
}
