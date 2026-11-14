// Tripwire MCP server (stdio). Lets any MCP agent — Claude Code, Codex, an OpenCrawl-coordinated
// session — research accounts, run watch passes and read shared team research.
// It talks to the running Tripwire app over HTTP, so agents and humans share one database,
// one ownership model and one cost log.
//
//   claude mcp add tripwire -- npx tsx mcp/server.mts        (app must be running: npm run dev)
//   TRIPWIRE_URL defaults to http://localhost:3000
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.TRIPWIRE_URL || "http://localhost:3000";
const AGENT_USER = process.env.TRIPWIRE_USER || "agent";

async function api(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `${r.status} ${text.slice(0, 200)}` };
  }
}

async function waitRun(id: string, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await api(`/api/runs/${id}`);
    if (s.error || s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "running", note: `Still running after ${timeoutMs / 1000}s. Poll get_account later.`, run_id: id };
}

// Compact, citation-first view for agents: every claim keeps its URL, quote and date.
function summarize(snap: Record<string, any> | null | undefined) {
  if (!snap) return null;
  return {
    company: snap.company,
    domain: snap.domain,
    researched_at: snap.created_at,
    researched_by: snap.created_by,
    displacement_score: snap.score,
    verdict: snap.verdict,
    score_breakdown: snap.breakdown,
    you_com_cost_usd: snap.cost,
    stack: (snap.tools ?? []).map((t: any) => ({
      tool: t.tool,
      role: t.role,
      confidence: t.confidence,
      latest: t.latest_date,
      stale: t.stale,
      receipts: t.evidence.slice(0, 3).map((e: any) => ({ quote: e.evidence_quote, url: e.url, source_type: e.source_type, date: e.date, signal: e.signal_type })),
    })),
    migration_signals: (snap.migrations ?? []).map((m: any) => ({ from: m.from, to: m.to, description: m.description, urls: m.evidence.map((e: any) => e.url) })),
    conflicts: (snap.conflicts ?? []).map((c: any) => ({ tool: c.tool, description: c.description, a: c.a.url, b: c.b.url, answer_check: c.check?.answer })),
    why_now: snap.brief?.content ?? null,
    why_now_sources: snap.brief?.sources ?? [],
  };
}

const text = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }] });

const server = new McpServer({ name: "tripwire", version: "0.1.0" });

server.registerTool(
  "research_account",
  {
    description:
      "Find live, cited evidence of which observability tools a company uses, whether it is switching, and why now. " +
      "Respects team coordination: if a teammate owns the account or it was researched in the last 6 hours, returns the shared research instead of spending API calls (set force=true to override). " +
      "Every claim includes source URL, verbatim quote and date.",
    inputSchema: {
      company: z.string().describe("Company name, e.g. 'DoorDash'"),
      domain: z.string().optional().describe("Company domain, e.g. 'doordash.com'. Resolved via You.com search if omitted."),
      category: z.string().default("observability"),
      force: z.boolean().default(false),
      user: z.string().optional().describe("Who is asking (shown in the team table). Defaults to TRIPWIRE_USER or 'agent'."),
    },
  },
  async ({ company, domain, category, force, user }) => {
    const d = await api("/api/research", { method: "POST", body: JSON.stringify({ company, domain, category, force, user: user || AGENT_USER }) });
    if (d.error) return text(d);
    if (d.decision === "started") {
      const s = await waitRun(d.run_id);
      return text({ decision: "researched_live", account_key: d.key, url: `${BASE}/account/${encodeURIComponent(d.key)}`, status: s.status, error: s.error, result: summarize(s.partial) });
    }
    const acct = await api(`/api/accounts/${encodeURIComponent(d.key)}`);
    return text({
      decision: d.decision === "fresh" ? "reused_shared_research" : "owned_by_teammate",
      note: d.decision === "fresh" ? `Reused research from ${acct.account?.last_researched_at}; saved ${d.saved_calls} API calls (~$${d.saved_cost?.toFixed(3)}).` : `${d.account.owner} owns this account. Shared research shown; no API calls made. Use force=true to run anyway.`,
      account_key: d.key,
      url: `${BASE}/account/${encodeURIComponent(d.key)}`,
      result: summarize(acct.snapshot),
    });
  }
);

server.registerTool(
  "check_for_changes",
  {
    description: "Run a lightweight watch pass on an already-researched account (fresh job posts and news, re-read known job pages). Returns what changed since the last snapshot and appends it to the shared change feed.",
    inputSchema: { account_key: z.string().describe("e.g. 'doordash.com|observability' (from research_account or list_accounts)"), user: z.string().optional() },
  },
  async ({ account_key, user }) => {
    const d = await api(`/api/accounts/${encodeURIComponent(account_key)}/check`, { method: "POST", body: JSON.stringify({ user: user || AGENT_USER }) });
    if (d.error) return text(d);
    const s = await waitRun(d.run_id);
    return text({ status: s.status, error: s.error, changes: s.changes, cost_usd: s.cost, score: s.partial?.score, verdict: s.partial?.verdict });
  }
);

server.registerTool(
  "get_account",
  {
    description: "Read the latest shared research, ownership and change feed for an account. Makes no external API calls.",
    inputSchema: { account_key: z.string() },
  },
  async ({ account_key }) => {
    const d = await api(`/api/accounts/${encodeURIComponent(account_key)}`);
    if (d.error) return text(d);
    return text({ account: d.account, result: summarize(d.snapshot), changes: d.changes?.slice(0, 20) });
  }
);

server.registerTool(
  "list_accounts",
  { description: "List the team's watched accounts with owner, verdict, score and last-researched info, plus total API spend saved by shared research.", inputSchema: {} },
  async () => text(await api("/api/accounts"))
);

await server.connect(new StdioServerTransport());
