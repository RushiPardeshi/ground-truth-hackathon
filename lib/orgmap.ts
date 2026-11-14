// Org map: company → regions → teams → incumbent tools each team uses + people on the team.
// Built by the You.com Research API with a structured output schema. Every node must cite a URL
// that Research actually returned as a source (or one of our verified evidence URLs); the rest
// is dropped. Confidence scores are computed here, deterministically, from source type and age,
// so they're explainable rather than model-asserted.
import { PRICE } from "./config";
import { getOrgMap, latestSnapshot, saveOrgMap } from "./db";
import { canonicalTool } from "./reconcile";
import { getProfile } from "./workspace";

const TOOL_SOURCES = ["job_post", "eng_blog", "vendor_case_study", "conference_talk", "profile", "news", "other"];
const PERSON_SOURCES = ["profile", "conference_talk", "blog_author", "job_post", "news", "other"];

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
              properties: {
                tool: { type: "string" }, evidence: { type: "string" }, source_url: { type: ["string", "null"] },
                source_type: { type: "string", enum: TOOL_SOURCES }, date: { type: ["string", "null"] },
              },
              required: ["tool", "evidence", "source_url", "source_type", "date"],
              additionalProperties: false,
            },
          },
          people: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" }, title: { type: "string" }, source_url: { type: ["string", "null"] },
                source_type: { type: "string", enum: PERSON_SOURCES }, as_of: { type: ["string", "null"] },
              },
              required: ["name", "title", "source_url", "source_type", "as_of"],
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

export interface Scored { score: number; why: string[] }
export interface OrgTool { tool: string; evidence: string; source_url: string; source_type: string; date: string | null; confidence: Scored }
export interface OrgPerson { name: string; title: string; source_url: string; source_type: string; as_of: string | null; confidence: Scored }
export interface OrgTeam { region: string; team: string; tools: OrgTool[]; people: OrgPerson[] }
export interface OrgMap { teams: OrgTeam[]; regions: string[]; sources: { url: string; title?: string }[]; dropped: number; cost: number; error?: string }

function monthsSince(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(/^\d{4}$/.test(d) ? `${d}-06-30` : d).getTime();
  return isFinite(t) ? (Date.now() - t) / (30.4 * 86400_000) : null;
}

export function toolConfidence(t: { source_type: string; date: string | null }, verified: boolean): Scored {
  const base: Record<string, number> = { vendor_case_study: 85, job_post: 75, eng_blog: 70, conference_talk: 65, profile: 55, news: 50, other: 40 };
  let s = base[t.source_type] ?? 40;
  const why = [`${t.source_type.replace("_", " ")} source: ${s}`];
  if (verified) { s += 10; why.push("matches verified evidence: +10"); }
  const m = monthsSince(t.date);
  const adj = m === null ? -10 : m < 6 ? 10 : m < 18 ? 0 : m < 36 ? -20 : -35;
  why.push(m === null ? "no date: -10" : `${Math.round(m)} months old: ${adj >= 0 ? "+" : ""}${adj}`);
  s += adj;
  return { score: Math.max(5, Math.min(98, s)), why };
}

export function personConfidence(p: { source_type: string; as_of: string | null }): Scored {
  const base: Record<string, number> = { profile: 70, job_post: 60, conference_talk: 55, blog_author: 50, news: 50, other: 40 };
  let s = base[p.source_type] ?? 40;
  const why = [`${p.source_type.replace("_", " ")} source: ${s}`];
  const m = monthsSince(p.as_of);
  const adj = m === null ? -15 : m < 6 ? 20 : m < 12 ? 10 : m < 24 ? -10 : -30;
  why.push(m === null ? "no date for role: -15" : `role seen ${Math.round(m)} months ago: ${adj >= 0 ? "+" : ""}${adj}`);
  s += adj;
  return { score: Math.max(5, Math.min(98, s)), why };
}

const g = globalThis as unknown as { __twOrgRunsV2?: Map<string, string> };
const inflight: Map<string, string> = g.__twOrgRunsV2 ?? new Map(); // key -> region being run ("" = all)
g.__twOrgRunsV2 = inflight;

export function orgMapStatus(key: string) {
  return { running: inflight.has(key), running_region: inflight.get(key) ?? null, map: getOrgMap(key) };
}

export function addRegion(key: string, region: string, user: string) {
  const cur = (getOrgMap(key)?.data as OrgMap | undefined) ?? { teams: [], regions: [], sources: [], dropped: 0, cost: 0 };
  if (!cur.regions.some((r) => r.toLowerCase() === region.toLowerCase())) cur.regions = [...cur.regions, region];
  saveOrgMap(key, user, cur);
}

export function startOrgMap(key: string, user: string, region?: string) {
  if (inflight.has(key)) return;
  inflight.set(key, region ?? "");
  buildOrgMap(key, user, region)
    .catch((e) => {
      const cur = (getOrgMap(key)?.data as OrgMap | undefined) ?? { teams: [], regions: [], sources: [], dropped: 0, cost: 0 };
      saveOrgMap(key, user, { ...cur, error: (e as Error).message });
    })
    .finally(() => inflight.delete(key));
}

const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?].*$/, "").toLowerCase();

async function buildOrgMap(key: string, user: string, region?: string) {
  const snap = latestSnapshot(key);
  if (!snap) throw new Error("Research the account first");
  const prof = getProfile(snap.category);
  const incumbents = snap.watchlist.length ? snap.watchlist : prof.incumbents;
  const known = snap.evidence
    .filter((e) => e.category !== "other")
    .slice(0, 15)
    .map((e) => `- ${e.tool} (${e.signal_type}, ${e.source_type}, ${e.date}): "${e.evidence_quote}" ${e.url}`)
    .join("\n");
  const input =
    `Map ${snap.company} (${snap.domain})'s organization for a seller (${prof.seller}) whose buyers use these incumbent tools: ${incumbents.join(", ")}.\n` +
    (region
      ? `Focus ONLY on the ${region} region: offices, teams and people based in ${region}. Set region to "${region}" on every team.\n`
      : `Group by region (e.g. "North America", "EMEA", "APAC", "India", or "Global" if unknown) and team (e.g. Platform, SRE, Data, Security, IT, Finance).\n`) +
    `For each team list which of the incumbent tools above it uses, with a short verbatim evidence phrase, the source URL, the source type and the source's date (YYYY-MM or YYYY-MM-DD, null if unknown). ` +
    `Also list publicly identifiable people on that team (leaders, engineers, admins, speakers, blog authors) with title, source URL, source type and the date their role was last confirmed (as_of).\n` +
    `Use job posts (they name team and location), engineering blogs, conference talks and public profiles. Only include items you found a source for; use null source_url if none. Never invent people or tools.\n` +
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
  const evidenceUrls = new Set(snap.evidence.map((e) => e.url));
  const allowed = new Set([...sources.map((s) => s.url), ...evidenceUrls]);
  const allowedHosts = new Set([...allowed].map(host));
  const ok = (u: string | null) => !!u && (allowed.has(u) || allowedHosts.has(host(u)));
  let dropped = 0;
  const content = typeof body.output?.content === "string" ? JSON.parse(body.output.content) : body.output?.content;
  type RawTeam = { region: string; team: string; tools: Omit<OrgTool, "confidence">[]; people: Omit<OrgPerson, "confidence">[] };
  const fresh: OrgTeam[] = ((content?.teams ?? []) as RawTeam[])
    .map((t) => {
      const tools = t.tools
        .filter((x) => {
          const isIncumbent = incumbents.some((w) => w.toLowerCase() === canonicalTool(x.tool, incumbents).toLowerCase());
          return ok(x.source_url) && isIncumbent ? true : (dropped++, false);
        })
        .map((x) => ({ ...x, tool: canonicalTool(x.tool, incumbents), source_url: x.source_url!, confidence: toolConfidence(x, evidenceUrls.has(x.source_url!)) }));
      const people = t.people
        .filter((x) => (ok(x.source_url) && x.name.trim().split(/\s+/).length >= 2 ? true : (dropped++, false)))
        .map((x) => ({ ...x, source_url: x.source_url!, confidence: personConfidence(x) }));
      return { region: region || t.region || "Global", team: t.team || "Engineering", tools, people };
    })
    .filter((t) => t.tools.length || t.people.length);

  const cur = (getOrgMap(key)?.data as OrgMap | undefined) ?? { teams: [], regions: [], sources: [], dropped: 0, cost: 0 };
  // A region run replaces that region's teams; a full run replaces everything except user-added empty regions.
  const keep = region ? (cur.teams ?? []).filter((t) => t.region.toLowerCase() !== region.toLowerCase()) : [];
  const teams = [...keep, ...fresh];
  const regions = [...new Set([...(cur.regions ?? []), ...teams.map((t) => t.region)])];
  saveOrgMap(key, user, { teams, regions, sources: [...(region ? cur.sources ?? [] : []), ...sources], dropped: (region ? cur.dropped ?? 0 : 0) + dropped, cost: (cur.cost ?? 0) + PRICE.research } satisfies OrgMap);
}
