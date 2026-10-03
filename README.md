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

node src/inbox.mjs                   # read an email export, propose tracker updates
node src/inbox.mjs --apply           # write the proposals you approved

node src/serve.mjs                   # local server the browser extension talks to
node src/serve.mjs --token           # the token to paste into the extension
node src/canary.mjs                  # check the autofill field map against live forms
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


### Assisted apply

A Chrome extension fills an application form from your profile and records what you
sent. It never submits. That is the position, not a first-version limitation: the
products that auto-submit send unreviewed screening answers, and a wrong salary number
reaches forty employers before anyone notices.

```bash
node src/serve.mjs          # then load extension/ unpacked at chrome://extensions
```

The extension is deliberately thin. It observes a page and applies what it is told;
everything that knows anything lives in ALYX. An extension carrying its own copy of your
profile would be a second source of truth, which is the failure this project exists to
fix.

Fields resolve by `autocomplete` token first, then `id`, then visible label text.
`autocomplete` leads because its tokens are a W3C standard, the same ones your browser's
own autofill uses, so an ATS cannot break them without breaking Chrome autofill too. That
makes the common fields near zero-maintenance and confines real breakage to screening
questions. `canary.mjs` checks the anchors against a live posting per vendor and exits
non-zero when a required one disappears, so a break surfaces on a schedule rather than
halfway through an application.

Greenhouse, Ashby and Lever are supported. Workday is not, deliberately: it is a
multi-page wizard inside iframes and would cost more than the other three combined, so
it gets the same "I submitted this" button that any unsupported site gets.

### Reading your inbox

`inbox.mjs` reads an email export and proposes tracker updates. It proposes; it never
decides, and every proposal cites the email it came from. Classification is ordered
regex, not a model, because a confident wrong guess about whether you were rejected is
worse than no guess.

Company matching is whole-word. An early version matched substrings and proposed
rejecting an application at Ploy on the strength of an email from Employ.

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
- **Tracker**: working. Append-only status history, lanes, two funnel rates. Imports an
  existing career-ops tracker via `src/migrate.mjs`.
- **Inbox ingest**: working. Proposes, never decides. Needs an email export at
  `data/inbox.json`.
- **Local server**: working. Token auth, bound to 127.0.0.1, sends no CORS headers so a
  page you visit cannot read your profile off localhost.
- **Assisted apply**: working, verified against a live Greenhouse form. Ashby is
  implemented but not yet verified against a live posting.
- **Resume registry**: working. Reads your resume library off disk rather than a config
  listing it, and records which resume went to which application.
- **Resume tailoring**: not built. Applications use a chosen variant, not a per-role
  rewrite.
- **Answer library**: not built. Screening answers are not yet reused across applications.
- **Desktop app**: exists, but still reads the old tracker format.
- **Scheduling**: none. Every scan and sync is run by hand.

## Prior art, and how this was built

ALYX did not start from nothing. [career-ops](https://github.com/career-ops-hq/career-ops),
by Santiago Fernández de Valderrama and its contributors, is where the idea came from: that
public ATS boards are scannable, that a model can score roles against a profile, and that all
of it can run on one machine with no account. It is MIT licensed and worth your time.

The limit I hit was history. Its tracker keeps one status per application, so a process that
ended in a rejection no longer shows the interview that came before it. That is a reasonable
design choice and a fine one for most people. It was the wrong one for me, because the thing
I most wanted to know was which stage applications were dying at, and that is why `store.mjs`
is append-only.

**ALYX is written from scratch, not forked, and shares no code with career-ops.** That was
checked rather than assumed: a line-level comparison across both codebases found only generic
JavaScript in common, the `import` statements and `process.argv.slice(2)` that every Node
project contains. The HTML and Workday helpers have matching function names and entirely
different implementations. No prose is shared.

The one deliberate connection is `src/migrate.mjs`, which reads career-ops' tracker file so
anyone moving across keeps the history they already have.

**The code was written with Claude.** The author is a recruiter, not a software engineer. The
judgment that shaped it is from the hiring side: that a tracker storing one status per row
loses its interviews, that a tool filling screening answers has to stop before it submits,
and that a matcher confidently proposing the wrong company is worse than one that asks.

## License

MIT
