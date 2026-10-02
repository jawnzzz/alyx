# PRD: Assisted Apply

**Status:** draft, awaiting sign-off
**Written:** 2026-08-27
**Owner:** maintainer

---

## Problem

Applying to a job and recording that you applied are two separate acts today, and the
second one keeps not happening. The tracker has been rebuilt from Gmail twice: once on
2026-08-03 when it held 7 rows against 46 real applications, and again on 2026-08-27 when
it held 51 against 73. Both times the data was recoverable only because employers happened
to send confirmation emails.

Every fix so far has been a better reconciler: read the inbox, read Simplify, guess which
records match. Reconciling is repair work. It runs after the damage.

The moment the record should be created is the moment the form is submitted. Whatever owns
that moment owns the truth. Right now nothing does.

A second, quieter problem: there is no way to answer "which version of my resume gets
replies." 73 applications is finally enough data to answer it, and the data does not exist,
because nothing has ever recorded which resume went where.

## Success criteria

1. An application submitted through ALYX appears in `applications.json` without any
   separate step, with the resume file used recorded on the record.
2. Zero applications submitted with a field ALYX filled incorrectly and did not flag.
3. After 30 applications, `track.mjs stats` can break the reply rate down by resume version.
4. Time from landing on a job posting to a submitted, tailored application is under two
   minutes for a role already in the pipeline.

## Scope

### In

- **Chrome extension (MV3)** that detects a supported application form and fills it.
- **Field mapping for Ashby and Greenhouse first.** Together these are 53% of applications
  (measured from the confirmation emails in the maintainer's own inbox). Workday (9) and SmartRecruiters (4)
  come later.
- **Local ALYX server** on localhost that the extension talks to. The extension holds no
  data of its own. One source of truth, which is the entire point.
- **Profile answers.** Name, contact, work authorization, sponsorship, salary expectation,
  notice period, EEO and veteran and disability responses, LinkedIn and portfolio URLs.
  Written once in `config/profile.md`, filled everywhere.
- **Answer library.** Free-text screening questions ("why this company", "describe a time")
  answered from a store of previous answers, keyed by question similarity.
- **Resume tailoring.** Builds a role-specific `.docx` via the existing WORKING RESUMES
  format and `make-resume-docx.py`. Pre-built for roles already scanned, built on demand
  for cold ones.
- **Record on submit.** Company, role, URL, date, resume filename, and the answers given.

### Explicitly out

- **Auto-submit.** ALYX fills and stops. the user presses submit. This is not a v1 shortcut
  to be revisited later, it is the product's position. Some tools in this category submit applications with
  unreviewed screening answers, which is how a wrong salary number or a misspelled name
  reaches forty employers before anyone notices.
- **Cover letter generation.** Separate problem, separate quality bar.
- **Bulk apply.** Applying to many roles quickly is not the bottleneck. Reply rate is.
- **Replacing Simplify.** Simplify keeps working. This does not migrate anything out of it.
- **Any ATS beyond the four the scanner already speaks**, until the first four are solid.
- **Storing credentials.** ALYX never handles an account password. The user is already
  logged in, or they log in themselves.

## Constraints

- **Local only.** No API keys, no accounts, no cloud. Consistent with the rest of ALYX.
- **The extension is thin.** All logic and all data live in ALYX. The extension observes
  the page and applies what it is told. This keeps the ATS-specific surface small enough
  to fix when a vendor changes their DOM.
- **Fail loudly.** A field the extension could not fill must be reported visibly, never
  left silently blank. A quiet partial fill is worse than no fill, because it looks done.
- **Never regress a record.** Same rule the tracker already enforces: an application that
  reached interview does not walk backward.

## Architecture

```
  Chrome extension                localhost:4571 (ALYX)
  ────────────────                ─────────────────────
  detect ATS + form   ──────────▶ GET  /profile
                                       standing answers
  read job posting    ──────────▶ POST /tailor
                                       builds .docx, returns path
                                       (instant if already scanned)
  render fill preview ◀──────────      field map + values
        │
   [ user reviews, edits, submits ]
        │
  detect submit       ──────────▶ POST /applied
                                       writes applications.json,
                                       records resume used
```

The server is the existing ALYX codebase with an HTTP surface on top. It reuses
`store.mjs` for writes, `evaluate.mjs` for scoring, and the docx builder for resumes.
Nothing is duplicated into the extension.

## Build order

| # | Milestone | Proves |
|---|---|---|
| 1 | Local server, `GET /profile`, `POST /applied` | The write path works end to end |
| 2 | Extension fills Ashby from the profile, stops before submit | The core loop is real |
| 3 | Submit detection writes the record automatically | The original problem is solved |
| 4 | Greenhouse field mapping | 53% coverage |
| 5 | Resume tailoring and `resumeUsed` on the record | Success criterion 3 becomes answerable |
| 6 | Answer library for screening questions | The slow part of applying gets fast |
| 7 | Workday, then SmartRecruiters | 75% coverage |

Milestone 3 is the point at which the tracker stops going stale. Everything after it is
leverage. If the project stalls, stalling after 3 still leaves the main problem fixed.

## Open questions

1. **Resume strategy.** One tailored resume per application, or a small set of variants
   (recruiting, CS/ops, AM) picked per role? Variants make criterion 3 answerable much
   sooner, because 73 applications across 3 variants has signal and 73 across 73 uniques
   has none.
2. **Where does the fill preview live?** An overlay drawn on the page, or a panel in the
   ALYX app with the browser next to it?
3. **Salary expectation.** A single number everywhere, or per-lane? The lanes have
   different markets.
4. **What happens on an unsupported ATS?** Fill nothing and stay silent, fill only the
   universal fields (name, email, phone, LinkedIn), or offer a one-click "record that I
   applied here" button with no filling at all?
5. **Submit detection.** Watching for a form submit event is fragile across single-page
   apps. Fallback is a visible "I submitted this" button in the overlay. Acceptable?

## Risks

- **DOM drift.** Vendors change their forms without notice and fills break silently. This
  is the standing maintenance cost, and the mitigation is loud failure plus a smoke test
  against a live posting per vendor.
- **Workday.** Multi-page wizard inside iframes, actively hostile to automation. It is 9
  of 57 applications and it may cost more than the other three combined. Deferred
  deliberately, and may be worth abandoning in favour of the "record that I applied"
  fallback.
- **Scope creep toward auto-submit.** Every assisted-apply product drifts here because it
  demos well. The answer stays no.
