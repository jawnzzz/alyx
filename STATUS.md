# ALYX status

**Updated 2026-08-28.** Read this first on a "where were we" session.

## The decision that matters

**`~/alyx` is the canonical tracker.** `~/career-ops` is read-only history from here
on. Nothing in it has been modified, moved or deleted, and nothing should be.

This reverses what a handoff note written earlier the same day assumed. That note treats
`~/career-ops/data/applications.md` as the live tracker and describes finishing a
`gmail-sync` producer inside career-ops. That work is superseded. Do not resume it.

## Where the applications came from

| Source | Count | How |
|---|---|---|
| career-ops markdown tracker | 51 | `src/migrate.mjs`, one time |
| Gmail confirmations and rejections | 22 | `src/inbox.mjs`, proposed then approved |
| **Total tracked** | **73** | 72 career lane, 1 other |

Interview history for CoStar, Lime and Equinox was restored separately by
`src/backfill-history.mjs`, because terminal statuses had hidden it.

## The funnel, as of the last run

```
applied            72
any reply          20   27.8%   includes rejections
engaged             5    6.9%   moved you forward
ever interviewed    4
never heard back   51
still open         56
quiet 30+ days     31
```

The old tracker reported 3.9% and zero interviews. Both were wrong, and wrong in the
pessimistic direction.

## What is built

| Piece | State |
|---|---|
| Scanner (`scan.mjs`) | Working. Greenhouse, Ashby, Lever, Workday. Skips roles already applied to. |
| Evaluator (`evaluate.mjs`) | Working, Claude-backed, read only. |
| Tracker (`track.mjs`, `store.mjs`) | Working. Append-only history, lanes, two funnel rates. |
| Inbox ingest (`inbox.mjs`) | Working. Proposes, never decides. Needs `data/inbox.json`. |
| Local server (`serve.mjs`) | Working. `/health` `/profile` `/resumes` `/application` `/applied`. Token auth, 127.0.0.1 only. |
| Extension (`extension/`) | Working, verified on a live Greenhouse form. Loaded unpacked. |
| Resume registry (`resumes.mjs`) | Working. Reads `~/Desktop/LINDSEY RESUMES` live. 6 variants, 13 selectable. |
| Canary (`canary.mjs`) | Working. Exits non-zero when a required anchor disappears. |

## What is not built

- **Resume tailoring (M5).** Building a role-specific resume from a base variant.
- **Answer library (M6).** Reusing screening-question answers across applications.
- **Follow-up engine.** Explicitly declined 2026-08-28. 51 applications sit with no reply
  and nothing watches them. Raise it again only if asked.
- **LinkedIn research.** Deferred. If built, it drafts and never sends, and it does not
  scrape.
- **Workday autofill.** Cut deliberately. 9 of 57 applications, and a multi-page wizard in
  iframes. The "I submitted this" button covers it instead.
- **Desktop app wiring.** Still reads the old format.
- **Scheduling.** Every scan and sync is manual.

## Running it

```bash
node src/serve.mjs           # start the local server
node src/serve.mjs --token   # the token the extension needs
node src/canary.mjs          # check the field map still matches live forms
node src/track.mjs stats --lane career
```

Extension loads unpacked from `extension/`. Options take the server URL and the token.

## Open items

1. **Okta and Pair Team** are tracked as `applied` with no role. A handoff note says both
   were rejected (2026-08-07 and 2026-08-06) and gives real titles: Okta = Digital
   Solutions Manager (Recruiting Tech & Learning Platforms), Pair Team = Senior Recruiter.
   Never approved, so never applied. Ask before writing.
2. **Simplify holds 998 tracked jobs**, most of them `Saved` rather than applied. Export CSV
   exists in their UI but produced no file when clicked. Any importer must filter to
   Applied or further, or every funnel number breaks.
3. **Ashby autofill is unverified.** Only Greenhouse has been tested against a live form.
4. **Barry's start date** and **Veho scale numbers** are still unresolved across sources.
