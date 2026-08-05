/**
 * Shared shape for every provider, so the scanner and filters never care which
 * board a job came from.
 */

/** HTML to readable plain text. Entities are decoded AFTER tags are stripped so
 *  an escaped "&lt;script&gt;" in the copy cannot become a real tag. */
export function stripHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m);
}

// Guard the codepoint: String.fromCodePoint throws on out-of-range values, and
// a malformed entity in a job description should not crash a whole scan.
function safeChar(code) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : '';
}

/** Canonical URL for dedup: drop tracking params, lowercase the host and path,
 *  strip a trailing slash. Two links to the same posting must collapse to one. */
export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|gh_src|source|ref|rltr|trackingId|refId|origin|eBP)/i.test(p)) u.searchParams.delete(p);
    }
    u.host = u.host.toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, '').toLowerCase();
    return u.toString();
  } catch {
    return String(raw || '').trim();
  }
}

export function normalizeJob(j) {
  return {
    source: j.source,
    company: j.company,
    id: j.id,
    reqId: j.reqId ?? null,
    title: (j.title || '').trim(),
    url: j.url,
    canonical: canonicalUrl(j.url),
    detailUrl: j.detailUrl ?? null,
    location: (j.location || '').trim(),
    team: j.team ?? null,
    employmentType: j.employmentType ?? null,
    compensation: j.compensation ?? null,
    postedAt: j.postedAt ?? null,
    // true when postedAt was derived from a human string like "Posted 2 Days Ago"
    postedApproximate: j.postedApproximate ?? false,
    description: j.description ?? null,
  };
}
