<p align="center">
  <img src="brand/wordmark.svg#gh-light-mode-only" width="260" alt="ALYX">
  <img src="brand/wordmark-white.svg#gh-dark-mode-only" width="260" alt="ALYX">
</p>

<p align="center">
  <strong>Your job search, on your machine.</strong><br>
  Scans public ATS boards. Scores roles with Claude. No API keys, no accounts, no cloud.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#design-decisions">Design decisions</a> ·
  <a href="#status">Status</a>
</p>

---

## Why

Job boards are noisy and job trackers are manual. Every tool in between either wants your data on their server or wants you to pay per API call.

ALYX sits between the boards and you. It pulls openings straight from the applicant tracking systems companies actually post on, throws out what obviously does not fit before spending anything on it, then asks Claude to score what survives against a profile you write once.

Everything stays in local files. The only network requests it makes are to the job boards themselves.

## Quick start

```bash
git clone https://github.com/jawnzzz/alyx && cd alyx
cp config/boards.example.json config/boards.json
cp config/profile.example.md config/profile.md
```

Edit both. `boards.json` is the companies you watch. `profile.md` is who you are, what you want, and what you will not take. Both are gitignored, because they are yours.

```bash
npm run scan        # find roles, zero cost
npm run evaluate    # score them
```

Scanning needs nothing but Node 20+. Evaluation needs the [Claude Code](https://claude.com/claude-code) CLI on your PATH.

## How it works

```
config/boards.json      which companies to watch
        │
   src/scan.mjs         public ATS endpoints → normalize → filter → dedupe
        │               no LLM, no keys, no cost
        ▼
   data/pipeline.json   roles worth a look, ranked by lane priority
        │
 src/evaluate.mjs       scores each against your profile via the Claude CLI
        │
        ▼
 data/evaluations.json  PASS / MARGINAL / FAIL, each with a reason
```

### Supported boards

| Provider | Auth | Endpoint | Notes |
|---|---|---|---|
| Greenhouse | none | `GET boards-api.greenhouse.io/v1/boards/{board}/jobs` | whole board in one request |
| Ashby | none | `GET api.ashbyhq.com/posting-api/job-board/{org}` | includes published pay ranges |
| Lever | none | `GET api.lever.co/v0/postings/{org}` | returns a bare array, not an object |
| Workday | none | `POST {host}/wday/cxs/{tenant}/{site}/jobs` | must be searched, not crawled |

Workday is the awkward one. With an empty search string a large tenant returns its **entire global board**, thousands of roles across every country, so anything you actually want sits far past any sane page limit. ALYX queries it once per search term and merges the results instead.

## Usage

```bash
node src/scan.mjs                    # scan everything in your config
node src/scan.mjs --dry-run          # show what would be added, write nothing
node src/scan.mjs --since 7          # only roles posted in the last week
node src/scan.mjs --matched-only     # only roles whose title matched
node src/scan.mjs --json             # machine readable

node src/evaluate.mjs                # score pending roles
node src/evaluate.mjs --limit 10
node src/evaluate.mjs --matched-only
node src/evaluate.mjs --json

node src/track.mjs add <url>         # record an application, details pulled from the pipeline
node src/track.mjs list --stale 21   # applications with no movement in three weeks
node src/track.mjs status <id> responded --note "recruiter replied"
node src/track.mjs stats --lane career
```

### Tracking

`track.mjs add <url>` reads the role straight out of `pipeline.json`, so recording
an application means pasting a link, not retyping a company and a title. Status
changes append to a history rather than overwriting a field, because a funnel
built from current state alone cannot tell a rejection that followed an
interview from one that followed silence.

`stats` reports two rates, deliberately. **Any reply** counts rejections, since a
rejection still means a human opened your application. **Engaged** counts only
what moved you forward. A search at 16% replies and 2% engagement has a
different problem from one where nothing comes back at all, and a single blended
number hides which one you have.

Every application carries a `lane`. One hire in a lane you are not targeting will
otherwise make a broken funnel look solved.

## Design decisions

The parts worth arguing about.

**The filter is deliberately conservative.** An unrecognised job title *passes* through to be judged later. Silently dropping a role you would have wanted is worse than showing you one you would not, and job titles are endlessly creative.

**Order in `includeTitle` is priority order.** The first pattern a title matches becomes its rank, so if recruiting terms come before account-management terms, recruiting roles sort to the top and get evaluated first. Evaluation costs time; spend it on the best candidates rather than whatever sorts first alphabetically.

**An error is never a rejection.** If evaluation fails, the verdict is `ERROR`, never `FAIL`, and the count is reported separately. A rate limit is not a judgement about a job. Conflating the two silently discards good roles while looking identical to a real rejection.

**Claude runs read-only.** `--allowedTools Read,Grep,Glob`. It scores; it never writes. Every file this project touches is written by the project itself.

**Evaluation checkpoints after every role.** Long runs get interrupted. Without this, an interrupted run loses everything it already scored.

**Descriptions are fetched at evaluation time, not scan time.** Scanning a thousand roles should be fast and free. Only the handful you actually evaluate need their full text pulled.

## Data

Everything lives in `data/`, gitignored:

| File | What |
|---|---|
| `pipeline.json` | roles found, ranked, pending evaluation |
| `seen.json` | canonical URLs already surfaced, so repeat scans stay quiet |
| `evaluations.json` | scored results |
| `applications.json` | what you applied to, with status history |

Your `config/boards.json` and `config/profile.md` are gitignored too. Nothing personal is tracked by git.

## Status

Honest state of things:

- **Scanner**: working, four providers, verified against live boards.
- **Evaluator**: working, Claude-backed, read-only.
- **Tracker**: working. Records applications, append-only status history, funnel stats. Imports an existing career-ops tracker via `src/migrate.mjs`.
- **Desktop app**: exists, but is not yet wired to this data layer. It currently reads a different tracker format. Porting it is the next piece of work.
- **Reply detection**: not built. Status changes are manual. Nothing reads your inbox, so the tracker is only as current as the last time you told it something.

## License

MIT
