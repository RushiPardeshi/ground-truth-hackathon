// Org map: company → regions → teams → tools + people, built by the You.com Research API
// with a structured output schema. Nodes must cite a URL that Research actually returned
// as a source (or one of our verified evidence URLs); anything else is dropped.
import { PRICE } from "./config";
import { getOrgMap, latestSnapshot, saveOrgMap } from "./db";

const SCHEMA = {
  type: "object",
  properties: {
    teams: {
      type: "array",
      items: {
        type: "object",
        properties: {
          region: { type: "string" },
          team: { type: "string" },
          tools: {
            type: "array",
            items: {
              type: "object",
              properties: { tool: { type: "string" }, evidence: { type: "string" }, source_url: { type: ["string", "null"] } },
              required: ["tool", "evidence", "source_url"],
              additionalProperties: false,
            },
          },
          people: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, title: { type: "string" }, source_url: { type: ["string", "null"] } },
              required: ["name", "title", "source_url"],
              additionalProperties: false,
            },
          },
        },
        required: ["region", "team", "tools", "people"],
        additionalProperties: false,
      },
    },
  },
  required: ["teams"],
  additionalProperties: false,
};

export interface OrgTeam {
  region: string;
  team: string;
  tools: { tool: string; evidence: string; source_url: string }[];
  people: { name: string; title: string; source_url: string }[];
}
export interface OrgMap { teams: OrgTeam[]; sources: { url: string; title?: string }[]; dropped: number; cost: number; error?: string }

const g = globalThis as unknown as { __twOrgRuns?: Set<string> };
const inflight: Set<string> = g.__twOrgRuns ?? new Set();
g.__twOrgRuns = inflight;

export function orgMapStatus(key: string) {
  return { running: inflight.has(key), map: getOrgMap(key) };
}

export function startOrgMap(key: string, user: string) {
  if (inflight.has(key)) return;
  inflight.add(key);
  buildOrgMap(key, user)
    .catch((e) => saveOrgMap(key, user, { teams: [], sources: [], dropped: 0, cost: 0, error: (e as Error).message } satisfies OrgMap))
    .finally(() => inflight.delete(key));
}

const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?].*$/, "").toLowerCase();

async function buildOrgMap(key: string, user: string) {
  const snap = latestSnapshot(key);
  if (!snap) throw new Error("Research the account first");
  const known = snap.evidence
    .filter((e) => e.category !== "other")
    .slice(0, 15)
    .map((e) => `- ${e.tool} (${e.signal_type}, ${e.source_type}, ${e.date}): "${e.evidence_quote}" ${e.url}`)
    .join("\n");
  const input =
    `Map ${snap.company} (${snap.domain})'s engineering organization for a B2B seller of observability tools (${snap.watchlist.join(", ")}).\n` +
    `Group by region (e.g. "US", "EMEA", "India", or "Global" if unknown) and team (e.g. Platform, SRE, Data, Security, Product Engineering).\n` +
    `For each team list the software tools it uses (observability first, then other infrastructure tools) with a short verbatim evidence phrase and the source URL, ` +
    `and publicly listed people on that team (engineering leaders, SREs, platform engineers, conference speakers, blog authors, public profiles) with their title and source URL.\n` +
    `Use job posts (they name team and location), engineering blogs, conference talks and public profiles. Only include items you found a source for; use null source_url if none, and never invent people.\n` +
    `Already verified evidence:\n${known || "(none)"}`;
  const res = await fetch("https://api.you.com/v1/research", {
    method: "POST",
    headers: { "X-API-Key": process.env.YDC_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ input, research_effort: "standard", output_schema: SCHEMA }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Research ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  const sources: { url: string; title?: string }[] = body.output?.sources ?? [];
  const allowed = new Set([...sources.map((s) => s.url), ...snap.evidence.map((e) => e.url)]);
  const allowedHosts = new Set([...allowed].map(norm));
  const ok = (u: string | null) => !!u && (allowed.has(u) || allowedHosts.has(norm(u)));
  let dropped = 0;
  const content = typeof body.output?.content === "string" ? JSON.parse(body.output.content) : body.output?.content;
  const teams: OrgTeam[] = (content?.teams ?? []).map((t: OrgTeam) => {
    const tools = t.tools.filter((x) => (ok(x.source_url) ? true : (dropped++, false)));
    const people = t.people.filter((x) => (ok(x.source_url) && x.name.trim().split(/\s+/).length >= 2 ? true : (dropped++, false)));
    return { region: t.region || "Global", team: t.team || "Engineering", tools, people };
  }).filter((t: OrgTeam) => t.tools.length || t.people.length);
  saveOrgMap(key, user, { teams, sources, dropped, cost: PRICE.research } satisfies OrgMap);
}
