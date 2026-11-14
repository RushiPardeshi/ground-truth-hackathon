// Reverse account discovery: who is hiring for <tool>?
// Discovery runs on You.com Search (query-level ATS targeting). Each hit is then verified
// against the ATS's own public, keyless job-board API (Greenhouse, Lever, Ashby): the posting
// must still be live and its full description must name the tool. Verified postings carry a
// verbatim quote from that description.
import { search, type CallSink } from "./you";

export type Ats = "greenhouse" | "ashby" | "lever";
export interface DiscoveredJob { title: string; url: string; snippet?: string; verified: boolean; status: "verified" | "live_no_mention" | "closed_or_unreachable" | "unchecked"; quote?: string; location?: string; team?: string }
export interface DiscoveredAccount { company: string; company_slug: string; ats: Ats; job_count: number; verified_count: number; sample_jobs: DiscoveredJob[] }

export function parseAtsUrl(url: string): { ats: Ats; slug: string; id?: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const h = u.hostname.toLowerCase();
    if (/(^|\.)greenhouse\.io$/.test(h)) {
      // boards.greenhouse.io/{slug}/jobs/{id} · job-boards.greenhouse.io/{slug}/jobs/{id} · embed?for=slug&token=id
      const slug = parts[0] === "embed" ? u.searchParams.get("for") ?? "" : parts[0] ?? "";
      const id = parts[1] === "jobs" ? parts[2] : u.searchParams.get("token") ?? undefined;
      return slug ? { ats: "greenhouse", slug: slug.toLowerCase(), id } : null;
    }
    if (h === "jobs.ashbyhq.com") return parts[0] ? { ats: "ashby", slug: parts[0].toLowerCase(), id: parts[1] } : null;
    if (h === "jobs.lever.co") return parts[0] ? { ats: "lever", slug: parts[0].toLowerCase(), id: parts[1] } : null;
  } catch {}
  return null;
}

const strip = (html: string) =>
  html
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Tripwire/0.1" }, signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function quoteAround(text: string, tool: string): string | undefined {
  const i = text.toLowerCase().indexOf(tool.toLowerCase());
  if (i < 0) return undefined;
  const start = Math.max(0, i - 100);
  const words = text.slice(start, i + tool.length + 100).split(" ");
  // drop partial edge words; the result is verbatim from the posting and always contains the tool
  return words.slice(start > 0 ? 1 : 0, -1).join(" ");
}

// Fetch one posting from the ATS public API. Returns null if it's gone (closed) or unreachable.
export async function fetchAtsJob(ats: Ats, slug: string, id?: string): Promise<{ title: string; text: string; location?: string; team?: string; company?: string } | null> {
  if (!id) return null;
  if (ats === "greenhouse") {
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`);
    return j ? { title: j.title, text: strip(j.content ?? ""), location: j.location?.name, team: j.departments?.[0]?.name, company: j.company_name } : null;
  }
  if (ats === "lever") {
    const j = await getJson(`https://api.lever.co/v0/postings/${slug}/${id}`);
    if (!j) return null;
    const lists = (j.lists ?? []).map((l: { text: string; content: string }) => `${l.text} ${strip(l.content ?? "")}`).join(" ");
    return { title: j.text, text: `${j.descriptionPlain ?? strip(j.description ?? "")} ${lists} ${j.additionalPlain ?? ""}`, location: j.categories?.location, team: j.categories?.team };
  }
  const board = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  const j = board?.jobs?.find((x: { id: string; jobUrl?: string }) => x.id === id || x.jobUrl?.includes(id));
  return j ? { title: j.title, text: j.descriptionPlain ?? strip(j.descriptionHtml ?? ""), location: j.location, team: j.department ?? j.team } : null;
}

const AGGREGATORS = /^(jobgether|remotehunter|hirequest|jobot|dice|cybercoders|talentify|recruitics|crossover|toptal|turing|andela)$/i;

const ATS_OR = "(site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.ashbyhq.com OR site:jobs.lever.co)";

export async function discoverAccounts(opts: {
  tool: string;
  category?: string;
  limit?: number;
  onProgress?: (msg: string) => void;
  sink?: CallSink;
}): Promise<DiscoveredAccount[]> {
  const { tool, limit = 15, onProgress = () => {} } = opts;
  const calls: string[] = [];
  const sink: CallSink = opts.sink ?? {
    log: (c) => { calls.push(c.api); onProgress(`${c.ok ? "✓" : "✗"} ${c.api} ${c.ms}ms $${c.cost.toFixed(4)} — ${c.note ?? ""}`); },
    count: () => 0,
    pages: () => 0,
  };
  const toolSlug = tool.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = `"${tool}"`;
  // Note: You.com documents site:, OR, +, - but not inurl:, so the vendor's own board is excluded in code below.
  const queries = [
    `${ATS_OR} ${t} ("requirements" OR "responsibilities" OR "our stack") ("engineer" OR "devops" OR "sre" OR "infrastructure")`,
    `${ATS_OR} ${t} experience engineer`,
    `${t} job requirements engineer ${ATS_OR}`,
  ];
  onProgress(`Searching ATS job boards for postings that mention ${tool}…`);
  const results = (await Promise.all(queries.map((q) => search(sink, q, { count: 50 })))).flat();

  const byCo = new Map<string, DiscoveredAccount & { _ids: Set<string> }>();
  for (const r of results) {
    const p = parseAtsUrl(r.url);
    if (!p) continue;
    if (p.slug.replace(/[^a-z0-9]/g, "").includes(toolSlug)) continue; // the vendor's own job board
    if (AGGREGATORS.test(p.slug)) continue; // boards that repost other companies' jobs
    const titleCo = (r.title ?? "").match(/\bat\s+([^|–]+?)\s*(?:[|–].*)?$/i)?.[1]?.trim();
    const cur = byCo.get(p.slug) ?? {
      company: titleCo || p.slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      company_slug: p.slug, ats: p.ats, job_count: 0, verified_count: 0, sample_jobs: [], _ids: new Set<string>(),
    };
    const id = p.id ?? r.url;
    if (cur._ids.has(id)) continue;
    cur._ids.add(id);
    cur.job_count++;
    if (cur.sample_jobs.length < 3) {
      cur.sample_jobs.push({ title: (r.title ?? "").replace(/^Job Application for\s+/i, ""), url: r.url, snippet: (r.snippets?.[0] ?? r.description ?? "").slice(0, 220), verified: false, status: "unchecked" });
    }
    byCo.set(p.slug, cur);
  }
  const cos = [...byCo.values()].sort((a, b) => b.job_count - a.job_count).slice(0, limit);
  onProgress(`${byCo.size} companies found; verifying postings for ${cos.length} via the Greenhouse/Lever/Ashby public job-board APIs…`);

  await Promise.all(
    cos.map(async (c) => {
      for (const j of c.sample_jobs) {
        const p = parseAtsUrl(j.url);
        const live = p ? await fetchAtsJob(p.ats, p.slug, p.id) : null;
        if (!live) { j.status = "closed_or_unreachable"; continue; }
        if (live.company) c.company = live.company;
        j.title = live.title || j.title;
        j.location = live.location;
        j.team = live.team;
        const q = quoteAround(live.text, tool);
        j.status = q ? "verified" : "live_no_mention";
        if (q) {
          j.verified = true;
          j.quote = q;
          c.verified_count++;
        }
      }
    })
  );
  // Verified accounts first; unverified ones stay (search snippet matched) but are flagged.
  return cos
    .map(({ _ids, ...c }) => { void _ids; return c; })
    .sort((a, b) => b.verified_count - a.verified_count || b.job_count - a.job_count);
}
