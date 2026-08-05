# ALYX

A local job search command center. Scans public ATS job boards, scores roles against your profile using Claude, and keeps every piece of your data on your own machine.

No API keys. No accounts. No server. Nothing about your search leaves your laptop except the requests to the job boards themselves.

## Why

Job boards are noisy and job trackers are manual. ALYX sits between them: it pulls openings straight from the ATS platforms companies actually post on, throws out what obviously does not fit before spending anything on it, then asks Claude to score what survives against a profile you write once.

## How it works

```
config/boards.json      which companies to watch
        |
   src/scan.mjs         hits public ATS endpoints, normalizes, filters, dedupes
        |               (zero LLM cost)
   data/pipeline.json   roles worth a look, ranked
        |
 src/evaluate.mjs       scores each against config/profile.md via the Claude CLI
        |
 data/evaluations.json  PASS / MARGINAL / FAIL with a reason for each
```

### Supported boards

| Provider | Auth | Notes |
|---|---|---|
| Greenhouse | none | full board in one request |
| Ashby | none | includes published pay ranges |
| Lever | none | returns a bare array, not an object |
| Workday | none | must be **searched**, not crawled, see below |

Workday is the awkward one. With an empty search a large tenant returns its entire global board, thousands of roles across every country, so anything you want sits far past any reasonable page limit. ALYX queries it once per search term instead and merges the results.

## Setup

```bash
git clone <your-repo> alyx && cd alyx
cp config/boards.example.json config/boards.json
cp config/profile.example.md config/profile.md
```

Edit both. `boards.json` is the companies you care about; `profile.md` is who you are and what you will and will not take. Both are gitignored, because they are your data.

Evaluation needs the [Claude Code](https://claude.com/claude-code) CLI on your PATH. Scanning does not.

## Use

```bash
npm run scan                        # scan everything
node src/scan.mjs --dry-run         # see what would be added, write nothing
node src/scan.mjs --since 7         # only roles posted in the last week
node src/scan.mjs --matched-only    # only roles whose title matched

npm run evaluate                    # score pending roles
node src/evaluate.mjs --limit 10
node src/evaluate.mjs --json
```

## Design decisions

**The filter is deliberately conservative.** An unrecognised job title passes through to be judged later. Silently dropping a role you would have wanted is worse than showing you one you would not, and job titles are endlessly creative.

**Order in `includeTitle` is priority order.** The first pattern a title matches becomes its rank, so if recruiting terms come before account-management terms, recruiting roles sort to the top and get evaluated first. This matters: evaluation costs time, and you want it spent on the best candidates rather than whatever is alphabetically first.

**An error is never a rejection.** If evaluation fails, the verdict is `ERROR`, never `FAIL`, with a count reported separately. A rate limit is not a judgement about a job, and conflating the two silently discards good roles while looking identical to a real rejection.

**Claude runs read-only.** `--allowedTools Read,Grep,Glob`. It scores; it never writes. Every file this project touches is written by the project itself.

**Evaluation checkpoints after every role.** Long runs get interrupted. Without this, an interrupted run loses everything it scored.

**Descriptions are fetched at evaluation time, not scan time.** Scanning 1,000 roles should be fast and free; only the handful you actually evaluate need their full text pulled.

## Data

Everything lives in `data/`, gitignored:

| File | What |
|---|---|
| `pipeline.json` | roles found, ranked, pending evaluation |
| `seen.json` | canonical URLs already surfaced, so repeat scans stay quiet |
| `evaluations.json` | scored results |

## Status

Scanner and evaluator are working. A desktop app front end exists separately and is not yet wired to this data layer.

## License

MIT
