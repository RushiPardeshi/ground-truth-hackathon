# Tripwire: live account intelligence with receipts

**Track: Live Wire** · Ground Truth: The Live Agents Hackathon (powered by You.com)

Tripwire tells an account executive at a challenger observability vendor (Datadog, Grafana, Honeycomb, Chronosphere) **which observability tools a target company runs today, whether it's switching, and why now**. Every claim links to a source, quotes it verbatim, and carries a date. Then Tripwire watches the account and reports what changed.

![Account page](docs/account.png)

## The problem

Sales teams at challenger vendors burn hours guessing at a prospect's stack. Static technographic databases are months stale and never show *why* they think a company uses Splunk. Tripwire reads the live web on demand (job posts, vendor case studies, engineering blogs, news, and the company's own site code) and shows the receipts.

**Who pays:** AEs and SDR teams at challenger software vendors, priced per watched account per month.

## How it works

```
company + domain + watchlist
   │
   ├─ 1 Plan      8 targeted queries (ATS job boards, careers × incumbents/challengers,
   │              migration language, vendor case studies, company site, eng blog, last-month news)
   ├─ 2 Search    You.com Web Search, in parallel, deduped; consumer pages, aggregator
   │              search pages, vendor careers pages and "tool-as-employer" pages filtered out
   ├─ 3 Read      You.com Contents: top pages as Markdown + homepage as raw HTML
   ├─ 4 Detect    deterministic script-signature scan of homepage HTML ("Confirmed (site code)")
   ├─ 5 Extract   LLM → JSON evidence; every quote is checked against the page text and
   │              DROPPED if it doesn't appear verbatim (count shown in the trace)
   ├─ 6 Reconcile confidence (Confirmed / Strong / Inferred), stale > 18 months,
   │              migration signals, conflicts shown side by side (+ You.com Answer check)
   ├─ 7 Score     Displacement Score 0–100 with a transparent breakdown
   ├─ 8 Brief     You.com Research (standard): cited "why now" brief
   └─ 9 Snapshot  evidence + per-page tool fingerprints, for diffing
```

**Watch mode:** "Check for changes" (or auto-check every N minutes) runs a light pass: fresh job-board and news search (`freshness: week`), plus a live re-read (`max_age: 0`) of known job posts. It diffs against the last snapshot (new URLs, new tools, removed postings, job posts that now mention or stop mentioning a tool) and writes a timestamped, attributed change feed. Research is called again **only** when a new Strong/Confirmed signal appears.

**Team coordination:** accounts are keyed by normalized domain + category, and company names resolve to domains first. If a teammate owns the account, you see "*X is covering Y*" with **View shared research** (zero API calls) or **Request handoff**. If anyone researched it in the last 6 hours, the snapshot is reused, and the saved calls and dollars are tracked on the home page.

**Never fabricate:** no evidence shows as "No evidence found." Every item carries URL, verbatim quote (verified), source type and date (published if known, otherwise marked *fetched*).

## You.com endpoints → features

| Endpoint | Powers |
|---|---|
| **Web Search** `POST ydc-index.io/v1/search` | Discovery: `include_domains` for ATS boards (Greenhouse, Lever, Ashby, Workday), vendor sites and the company's own site; `freshness: month/week` for recent signals and watch mode; domain resolution for company names |
| **Contents** `POST ydc-index.io/v1/contents` | Full pages as Markdown for extraction; homepage as **HTML** for script detection (falls back to a plain fetch only if no `<script>` tags come back); `max_age: 0` live re-reads in watch mode |
| **Research** `POST api.you.com/v1/research` (`research_effort: standard`) | One cited "why now" brief per account, seeded with our verified evidence |
| **Answer** `POST api.you.com/v1/answer` | Quick cited check on the top conflict |

Every call is timed, cost-estimated at list price, capped per run (15 searches, 25 pages, 1 research, 1 answer), logged in the agent trace, and the run total is shown in the UI.

**LLM (extraction):** provider order is **You.com Inference Router** (same `YDC_API_KEY`, auto-detected via `GET /v1/models` each run; override the model with `TRIPWIRE_YOU_MODEL`), then the Anthropic API (`claude-opus-5-5`), then a **rule-based extractor** that only emits sentences copied straight from the page, with guards against reversed relationships (e.g. "Splunk uses Anaplan", or a Dynatrace job post that lists Anaplan as a skill). Whatever produces the JSON, every quote is then verified against the page text. The trace shows which extractor ran.

## For agents (MCP + CLI + JSON API)

Tripwire is built to be driven by other agents, e.g. parallel coding agents coordinated through an OpenCrawl board, as well as by humans. Agents and humans share one database, one ownership model and one cost log. See [AGENTS.md](AGENTS.md).

- **MCP server** (`.mcp.json` included): `research_account`, `check_for_changes`, `get_account`, `list_accounts`
- **CLI:** `npm run research -- "Anaplan" anaplan.com` → evidence JSON on stdout, trace on stderr
- **HTTP:** `POST /api/research`, `GET /api/runs/:id`, `GET /api/accounts`, `GET /api/accounts/:key`, `POST /api/accounts/:key/check`

## Setup

```bash
npm install
cp .env.example .env.local   # add YDC_API_KEY (ANTHROPIC_API_KEY optional fallback)
npm run dev                  # http://localhost:3000
```

Data lives in `data/tripwire.db` (SQLite, git-ignored).

**Demo safety:** if a live run fails (e.g. wifi), the last good snapshot is shown and clearly labelled *CACHED*. The default demo run is live.

![Home](docs/home.png)

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind · SQLite (better-sqlite3) · You.com APIs · Anthropic SDK · MCP TypeScript SDK
