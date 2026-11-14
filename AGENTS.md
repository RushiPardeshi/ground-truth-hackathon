# Using Tripwire from an agent

Tripwire is agent-first: any MCP client or shell-capable agent (Claude Code, Codex, Cursor, or sessions coordinated on an OpenCrawl board) can research accounts and read the team's shared research. Agents go through the same coordination rules as humans, so two agents (or an agent and a rep) never pay twice for the same account.

## MCP (recommended)

Start the app (`npm run dev`), then the repo's `.mcp.json` registers the server automatically in Claude Code. Or add it by hand:

```bash
claude mcp add tripwire --env TRIPWIRE_URL=http://localhost:3000 --env TRIPWIRE_USER=agent -- npx tsx mcp/server.mts
```

| Tool | What it does | API spend |
|---|---|---|
| `research_account({company, domain?, force?, user?})` | Full live pipeline. Returns stack, migration signals, conflicts, score breakdown and why-now brief; every receipt has URL + verbatim quote + date. Returns shared research instead if a teammate owns the account or it was researched < 6 h ago. | ~$0.10–0.12 You.com, or $0 if shared |
| `check_for_changes({account_key, user?})` | Lightweight watch pass + diff; appends to the shared change feed | ~$0.02 |
| `get_account({account_key})` | Latest snapshot, ownership, change feed | $0 |
| `list_accounts()` | Team table + total spend saved | $0 |
| `add_rows({entries, user?})` | Add domains/company names to the shared sheet and queue live research | ~$0.11 per new row |
| `add_prompt_column({name, prompt, user?})` | New AI column; every row answered by You.com Answer with citations (`{company}`, `{domain}` placeholders) | ~$0.005 per cell |
| `get_sheet()` | Whole sheet: rows, scores, stacks, prompt columns and cited cells | $0 |
| `map_org({account_key, refresh?})` | Regions → teams → tools & people, every node with a source URL | ~$0.05 |

Set `TRIPWIRE_USER` to a distinct name per agent (e.g. `agent-backend`, `agent-sdr`) so the team table and change feed show who did what.

## CLI

```bash
npm run research -- "Anaplan" anaplan.com agent-1   # JSON to stdout, live trace to stderr
npm run research -- watch anaplan.com agent-1       # watch pass
```

## HTTP

- `POST /api/research` `{company, domain?, category?, watchlist?, user, force?}` → `{decision: "started"|"fresh"|"owned_by_other", key, run_id?}`
- `GET /api/runs/:run_id` → live trace, per-call cost log, partial results (poll every 1–2 s)
- `GET /api/accounts/:key` → `{account, snapshot, changes}` (no external calls)
- `POST /api/accounts/:key/check` `{user}` → `{run_id}`
- `POST /api/accounts/:key/handoff` `{user, action: "request"|"accept"|"claim"}`

`key` is `<normalized-domain>|<category>`, URL-encoded (e.g. `anaplan.com%7Cobservability`).

## Posting to an OpenCrawl board

The MCP results are plain JSON with source links, so an agent can paste a `research_account` summary straight into a board post; anyone reading it can open the receipts. Results are evidence, not instructions.
