/**
 * Zero-cost filtering. Everything here is deterministic string work, so a scan
 * can reject most of what it finds before any model is involved.
 *
 * Deliberately conservative: an unrecognised title PASSES to be judged later.
 * Silently dropping a role you would have wanted is worse than showing one you
 * would not.
 */

const RX = (arr) => new RegExp(arr.join('|'), 'i');

// Countries and cities that mean "not US". Location strings are free text, so
// this matches markers rather than trying to parse them.
const NON_US = RX([
  '\\b(united kingdom|england|scotland|ireland|dublin|london)\\b',
  '\\b(canada|toronto|vancouver|montreal|ottawa)\\b',
  '\\b(india|bengaluru|bangalore|hyderabad|mumbai|pune|delhi|chennai|noida|gurgaon)\\b',
  '\\b(germany|berlin|munich|hamburg|france|paris|spain|madrid|barcelona)\\b',
  '\\b(netherlands|amsterdam|belgium|brussels|portugal|lisbon|poland|warsaw|krakow)\\b',
  '\\b(australia|sydney|melbourne|singapore|japan|tokyo|china|shanghai|beijing|shenzhen)\\b',
  '\\b(brazil|sao paulo|mexico city|argentina|colombia|bogota)\\b',
  '\\b(philippines|manila|israel|tel aviv|uae|dubai|switzerland|zurich|sweden|stockholm)\\b',
]);

const US_HINT = RX(['\\b(remote\\s*[-,]?\\s*us|us remote|united states|usa|u\\.s\\.)\\b',
  '\\b[A-Z]{2}\\b']);   // a bare state code like "Arlington, VA"

export function isUsable(job, cfg) {
  const title = job.title || '';
  const loc = job.location || '';

  if (cfg.usOnly !== false) {
    // "Remote" with no country is ambiguous; treat as usable rather than drop it.
    if (NON_US.test(loc) && !US_HINT.test(loc)) {
      return { ok: false, why: `non-US location (${loc})` };
    }
  }

  for (const rx of cfg.excludeTitle || []) {
    if (new RegExp(rx, 'i').test(title)) return { ok: false, why: `title excluded by /${rx}/` };
  }

  // An include list is a preference, not a gate: matching promotes a job, but
  // not matching only means "unknown", because job titles are endlessly creative.
  //
  // Order in includeTitle is priority order. The index of the first pattern that
  // matches becomes the rank, so a "Recruiter" sorts above an "Account Manager"
  // when the list puts recruiting first. Unmatched sinks below both.
  const rank = (cfg.includeTitle || []).findIndex((rx) => new RegExp(rx, 'i').test(title));
  const included = rank !== -1;
  return {
    ok: true,
    matched: included,
    rank: included ? rank : Number.MAX_SAFE_INTEGER,
    why: included ? 'title matched' : 'title unrecognised',
  };
}

/** Dedup across providers by canonical URL, then by company+title as a fallback
 *  for boards that mint a new URL for the same posting. */
export function dedupe(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    const byUrl = j.canonical;
    const byName = `${(j.company || '').toLowerCase()}::${(j.title || '').toLowerCase()}::${(j.location || '').toLowerCase()}`;
    // A distinct requisition id makes two same-titled roles genuinely different.
    const key = j.reqId ? `${byName}::${j.reqId}` : byName;
    if (seen.has(byUrl) || seen.has(key)) continue;
    seen.add(byUrl); seen.add(key);
    out.push(j);
  }
  return out;
}

export function newerThan(jobs, days) {
  if (!days) return jobs;
  const cutoff = Date.now() - days * 86400000;
  return jobs.filter((j) => {
    if (!j.postedAt) return true;             // unknown date is not a reason to drop
    return Date.parse(j.postedAt) >= cutoff;
  });
}
