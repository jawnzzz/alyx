# PRD: ALYX Tracker

Status: awaiting sign-off
Date: 2026-08-06

## Problem

ALYX finds roles and scores them. It has no memory of what happened next. The
moment you apply to something, the system stops knowing about it, so there is no
answer to "what did I send, when, and did anyone reply."

The tracker being replaced (career-ops `data/applications.md`) failed in a
specific, documented way: on 2026-08-03 it was found to be missing 46 of 53
applications. Everything had to be reconstructed from Gmail. Two causes, both
worth designing against:

1. Adding an application was a manual markdown table edit, so it only happened
   when you remembered to do it.
2. Nothing ever checked whether the tracker matched reality.

## Success criteria

1. Recording an application takes one command and no retyping of company, role,
   or URL. That data already exists in `pipeline.json`.
2. Every application carries its own status history with dates, so "when did
   they go quiet" is answerable without reading notes prose.
3. All 56 rows of the career-ops tracker land in ALYX with nothing dropped, and
   the migration is verifiable before it is trusted.
4. `alyx track stats` reports the real funnel (applied / responded /
   interviewing / offer / rejected) without hand counting.
5. Zero new dependencies. Node 20+ and nothing else, same as the scanner.

## Scope

### In

- `data/applications.json`, the record store.
- `src/track.mjs`, a CLI with subcommands:
  - `add <url | pipeline #>` create an application, pulling company/role/url/
    source/score straight from pipeline.json or evaluations.json
  - `list [--status X] [--stale N]` show applications, default sorted by most
    recently touched
  - `status <id> <new-status> [--note "..."]` move an application, appending to
    its history rather than overwriting
  - `note <id> "..."` append a timestamped note
  - `stats` the funnel
- `src/migrate.mjs`, a one-time importer for career-ops `data/applications.md`.
  Dry-run by default, writes only with `--apply`.
- Status vocabulary, fixed and normalized:
  `applied`, `responded`, `interviewing`, `offer`, `rejected`, `withdrawn`.
- Linking back: a role that has an application is marked as such in pipeline
  output so scans stop resurfacing roles you already applied to.

### Out (deliberately, for v1)

- Gmail sync and automatic status detection from email. This is the highest
  value follow-on and the reason the old tracker got fixed, but it needs auth
  and a reply matcher, and it should sit on top of a record store that already
  works.
- Follow-up reminders and cadence.
- Any UI. CLI and JSON only.
- Resume tailoring, cover letters, contacts, interview prep. career-ops does
  those. Replacing them is a separate decision, not this one.

## Constraints

- No dependencies.
- Human-readable JSON on disk. It must be editable by hand and diffable, since
  hand-fixing is how the last tracker got recovered.
- `data/` stays gitignored. Nothing personal is ever committed.
- Append-only history. A status change never destroys the previous status.
- Migration must not touch, move, or delete anything in `~/career-ops`.

## Status vocabulary and migration mapping

| career-ops | ALYX | Note |
|---|---|---|
| Applied | `applied` | 41 rows |
| Rejected | `rejected` | 7 rows |
| Responded | `responded` | 1 row |
| Hired | `offer` | 1 row, verify what this actually was |
| Discarded | `withdrawn` | 1 row |
| Evaluated | not imported | 5 rows, these were never applications |

Open question flagged during design: the career-ops `#` column is not unique
(rows run 76, 77, 78, 30, 31 ...), a leftover from the Gmail backfill. ALYX will
key on canonical URL where one exists and a generated id where it does not,
rather than trusting that number.

## Plan

1. `src/store.mjs`, read/write/validate `applications.json`. Atomic writes.
2. `src/track.mjs`, the CLI, built on the store.
3. `src/migrate.mjs`, dry-run importer with a printed diff of what it would add.
4. Run the migration for real, spot-check against the markdown source.
5. Wire `scan.mjs` to skip roles that already have an application.
6. Update README status section to stop calling the tracker unbuilt.

## Open questions

1. The "Hired" row. Which application was that, and is it accurate? It changes
   the funnel numbers materially at this sample size.
2. Do you want applications you never applied to (interested-but-not-sent) in
   the tracker at all, or does pipeline.json already serve that purpose? Current
   design says pipeline.json is the "considering" list and the tracker starts at
   `applied`.
3. Does retiring career-ops mean turning off its 8am daily scan, or does that
   keep running until ALYX's scanner is scheduled? Two systems scanning and only
   one tracking is how records get lost.
