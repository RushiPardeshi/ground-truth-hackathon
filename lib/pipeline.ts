import crypto from "crypto";
import { CAPS, JOB_DOMAINS, SCRIPT_SIGNATURES, getCategory, type CategoryPreset } from "./config";
import { addChanges, getAccount, getAlias, latestSnapshot, saveSnapshot, setAlias, upsertAccount } from "./db";
import { extractFromPage, markAnthropicDown, normalizeText, pickProvider, quoteAppears, relevantWindows, ruleExtract, type ExtractedItem, type Provider } from "./llm";
import { canonicalTool, confidenceFor, hostOf, isStale, reconcile, score } from "./reconcile";
import type { ApiCallLog, ChangeItem, Evidence, RunState, Snapshot, TraceEvent } from "./types";
import { answer, contents, research, search, type CallSink, type PageContent, type SearchResult } from "./you";

// ---------- run registry (in-memory, survives Next dev HMR) ----------
const g = globalThis as unknown as { __twruns?: Map<string, RunState> };
export const runs: Map<string, RunState> = g.__twruns ?? new Map();
g.__twruns = runs;

export function accountKey(domain: string, category: string) {
  return `${normalizeDomain(domain)}|${category}`;
}

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
}

function aliasOf(company: string) {
  return company.toLowerCase().replace(/[.,]/g, "").replace(/\b(inc|co|corp|corporation|company|ltd|llc|plc|the)\b/g, "").replace(/\s+/g, " ").trim();
}

class Run implements CallSink {
  state: RunState;
  constructor(key: string, kind: RunState["kind"]) {
    this.state = { id: crypto.randomUUID(), key, kind, status: "running", started_at: Date.now(), trace: [], calls: [], cost: 0, partial: {} };
    runs.set(this.state.id, this.state);
  }
  log(c: ApiCallLog) {
    this.state.calls.push(c);
    this.state.cost += c.cost;
    this.trace(c.api === "search" ? "search" : c.api === "contents" ? "read" : c.api === "research" ? "brief" : "info", `${c.ok ? "✓" : "✗"} ${c.api} ${c.ms}ms $${c.cost.toFixed(4)} — ${c.note ?? ""}`);
  }
  count(api: ApiCallLog["api"]) {
    return this.state.calls.filter((c) => c.api === api).length;
  }
  pages() {
    return this.state.calls.filter((c) => c.api === "contents").reduce((n, c) => n + (c.pages ?? 0), 0);
  }
  trace(step: TraceEvent["step"], message: string, detail?: unknown) {
    this.state.trace.push({ t: Date.now() - this.state.started_at, step, message, detail });
  }
}

// ---------- domain resolution ----------
export async function resolveDomain(company: string, domainHint: string | undefined, sink?: CallSink): Promise<{ domain: string; resolved: boolean }> {
  if (domainHint?.trim()) {
    const d = normalizeDomain(domainHint);
    setAlias(aliasOf(company || d), d);
    return { domain: d, resolved: false };
  }
  if (/\.[a-z]{2,}$/i.test(company.trim()) && !company.includes(" ")) return { domain: normalizeDomain(company), resolved: false };
  const cached = getAlias(aliasOf(company));
  if (cached) return { domain: cached, resolved: true };
  const own = sink ?? { log() {}, count: () => 0, pages: () => 0 };
  const r = await search(own, `${company} official website`, { count: 5 });
  const skip = /wikipedia|linkedin|crunchbase|bloomberg|facebook|twitter|x\.com|youtube|glassdoor|indeed/;
  const hit = r.map((x) => hostOf(x.url)).find((h) => h && !skip.test(h));
  if (!hit) throw new Error(`Could not resolve a domain for "${company}". Enter the domain.`);
  const d = hit.split(".").slice(-2).join(".") === "co.uk" ? hit.split(".").slice(-3).join(".") : hit.split(".").slice(-2).join(".");
  setAlias(aliasOf(company), d);
  return { domain: d, resolved: true };
}

// ---------- helpers ----------
// What a page says about the watchlist (stable across cache vs live fetches).
function toolFingerprint(text: string, watchlist: string[]): string {
  const l = text.toLowerCase();
  return "tools:" + watchlist.filter((w) => l.includes(w.toLowerCase())).sort().join(",");
}

function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function isoDate(s?: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function guessSource(url: string, domain: string, cat: CategoryPreset): Evidence["source_type"] {
  const h = hostOf(url);
  if (/\/blog\/|engineering\.|\/engineering\//.test(url) && !JOB_DOMAINS.some((j) => h.endsWith(j))) return "eng_blog";
  if (JOB_DOMAINS.some((j) => h.endsWith(j)) || /careers|jobs|\/job\//.test(url)) return "job_post";
  if (Object.values(cat.vendorDomains).some((v) => h.endsWith(v))) return "vendor_case_study";
  if (h.endsWith(domain) && /blog|engineering/.test(url + h)) return "eng_blog";
  if (h.endsWith(domain)) return "news";
  if (/sec\.gov/.test(h)) return "filing";
  return "other";
}

function mentionsCompany(r: SearchResult, company: string, domain: string) {
  const hay = `${r.url} ${r.title ?? ""} ${r.description ?? ""} ${(r.snippets ?? []).join(" ")}`.toLowerCase();
  const name = company.toLowerCase();
  const slug = domain.split(".")[0];
  return hay.includes(name) || hay.includes(slug);
}

function priority(url: string, domain: string, cat: CategoryPreset) {
  const s = guessSource(url, domain, cat);
  return { job_post: 0, vendor_case_study: 1, eng_blog: 2, news: 3, filing: 3, other: 4, site_code: 5 }[s];
}

export function detectScripts(html: string, homepage: string, fetchedDate: string, cat: CategoryPreset): Evidence[] {
  const tags = html.match(/<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*>/gi) ?? [];
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const sig of SCRIPT_SIGNATURES) {
    if (seen.has(sig.tool)) continue;
    const tag = tags.find((t) => t.toLowerCase().includes(sig.pattern.toLowerCase()));
    if (!tag) continue;
    seen.add(sig.tool);
    const i = tag.toLowerCase().indexOf(sig.pattern.toLowerCase());
    const quote = tag.slice(Math.max(0, i - 40), i + sig.pattern.length + 40).replace(/\s+/g, " ");
    out.push({
      id: sha1(homepage + sig.tool),
      tool: sig.tool,
      category: sig.category === "observability" ? cat.id : "other",
      signal_type: "uses",
      evidence_quote: quote,
      url: homepage,
      title: "Homepage source code",
      source_type: "site_code",
      date: fetchedDate,
      date_kind: "fetched",
      confidence: "Confirmed",
      stale: false,
    });
  }
  return out;
}

async function plainFetch(url: string, run: Run): Promise<string> {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Tripwire)" }, signal: ctrl.signal });
    clearTimeout(timer);
    const t = await res.text();
    run.log({ api: "http", ms: Date.now() - t0, cost: 0, ok: res.ok, note: `plain GET ${url} (script-detection fallback)` });
    return t;
  } catch (e) {
    run.log({ api: "http", ms: Date.now() - t0, cost: 0, ok: false, note: `${url}: ${(e as Error).message}` });
    return "";
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

// Extract + verify evidence from a set of pages.
async function extractPages(
  run: Run,
  pages: (PageContent & { page_age?: string })[],
  company: string,
  domain: string,
  cat: CategoryPreset,
  watchlist: string[],
  onItem: (e: Evidence) => void
): Promise<{ evidence: Evidence[]; dropped: number; tokens: number; hashes: Record<string, string> }> {
  const today = new Date().toISOString().slice(0, 10);
  const terms = [...watchlist, "migrat", "observability", "monitoring"];
  let dropped = 0;
  let tokens = 0;
  const hashes: Record<string, string> = {};
  const all: Evidence[] = [];
  let provider: Provider = await pickProvider();
  run.trace("extract", provider.kind === "rules" ? `Extractor: rule-based, verbatim sentences only (${provider.reason})` : `Extractor: ${provider.kind === "you" ? "You.com Inference Router" : "Anthropic"} · ${provider.model}`);
  await pool(pages, 6, async (p) => {
    const text = p.markdown || "";
    if (!text) return;
    hashes[p.url] = toolFingerprint(text, watchlist);
    const lower = text.toLowerCase();
    if (!watchlist.some((w) => lower.includes(w.toLowerCase()))) {
      run.trace("extract", `skip (no watchlist tool mentioned): ${p.url}`);
      return;
    }
    const windows = relevantWindows(text, terms);
    const t0 = Date.now();
    try {
      let items: ExtractedItem[];
      if (provider.kind === "rules") {
        items = ruleExtract(windows, company, watchlist, guessSource(p.url, domain, cat) === "job_post", `${p.title ?? ""} ${p.url}`);
      } else {
        try {
          const r = await extractFromPage({ company, domain, tools: watchlist, url: p.url, title: p.title, text: windows, provider });
          items = r.items;
          tokens += r.tokens;
          run.state.calls.push({ api: "llm", ms: Date.now() - t0, cost: 0, ok: true, note: `${provider.kind}:${provider.model} ${p.url}`, tokens: r.tokens });
        } catch (err) {
          const msg = (err as Error).message;
          if (/401|403|402|authentication|api[- ]key|credit/i.test(msg)) {
            if (provider.kind === "anthropic") markAnthropicDown();
            run.trace("error", `${provider.kind} LLM unavailable (${msg.slice(0, 80)}). Switching to rule-based extraction (verbatim sentences only).`);
            provider = { kind: "rules", reason: msg.slice(0, 80) };
          } else run.trace("error", `LLM failed on ${p.url}: ${msg.slice(0, 120)}; using rule-based extraction for this page`);
          items = ruleExtract(windows, company, watchlist, guessSource(p.url, domain, cat) === "job_post", `${p.title ?? ""} ${p.url}`);
        }
      }
      const norm = normalizeText(text);
      let kept = 0;
      for (const it of items) {
        if (!it.about_target_company || !quoteAppears(it.evidence_quote, norm)) {
          dropped++;
          continue;
        }
        const tool = canonicalTool(it.tool, watchlist);
        const source = it.source_type === "other" ? guessSource(p.url, domain, cat) : it.source_type;
        const urlYear = p.url.match(/\/(20[0-2]\d)\//)?.[1];
        const pub = isoDate(it.published_date) || isoDate(p.page_age) || (urlYear ? `${urlYear}-01-01` : null);
        const date = pub || today;
        const e: Evidence = {
          id: sha1(p.url + tool + it.evidence_quote),
          tool,
          category: cat.id,
          signal_type: it.signal_type,
          evidence_quote: it.evidence_quote.trim(),
          url: p.url,
          title: p.title,
          source_type: source,
          date,
          date_kind: pub ? "published" : "fetched",
          confidence: confidenceFor(source, p.url, domain),
          stale: isStale(date),
        };
        if (all.some((x) => x.id === e.id)) continue;
        all.push(e);
        onItem(e);
        kept++;
      }
      run.trace("extract", `${kept} kept / ${items.length - kept} dropped — ${p.title?.slice(0, 70) ?? p.url}`, { url: p.url });
    } catch (e) {
      run.state.calls.push({ api: "llm", ms: Date.now() - t0, cost: 0, ok: false, note: `${p.url}: ${(e as Error).message}` });
      run.trace("error", `extract failed for ${p.url}: ${(e as Error).message.slice(0, 160)}`);
    }
  });
  return { evidence: all, dropped, tokens, hashes };
}

function buildQueries(company: string, domain: string, cat: CategoryPreset, watchlist: string[]) {
  const q = (s: string) => `"${company}"`.length > 0 ? s : s;
  const inc = watchlist.filter((t) => cat.incumbents.includes(t));
  const chal = watchlist.filter((t) => !cat.incumbents.includes(t));
  const orList = (xs: string[]) => xs.map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" OR ");
  const vendorDomains = watchlist.map((t) => cat.vendorDomains[t]).filter(Boolean);
  return [
    { label: "Job boards (ATS)", query: q(`${company} engineer ${orList(watchlist)}`), opts: { include_domains: JOB_DOMAINS, count: 15 } },
    { label: "Careers × incumbents", query: `"${company}" careers job ${orList(inc)}`, opts: { count: 10 } },
    { label: "Careers × challengers", query: `"${company}" careers job ${orList(chal)}`, opts: { count: 10 } },
    { label: "Migration language", query: `"${company}" migrate from ${orList(inc)}`, opts: { count: 10 } },
    { label: "Vendor case studies", query: `"${company}" customer story`, opts: { include_domains: vendorDomains, count: 10 } },
    { label: "Company site", query: `${orList(watchlist)} ${cat.keywords[0]}`, opts: { include_domains: [domain], count: 10 } },
    { label: "Engineering blog", query: `"${company}" engineering blog ${cat.keywords.join(" ")}`, opts: { count: 10 } },
    { label: "Recent news (month)", query: `"${company}" ${orList(watchlist)}`, opts: { freshness: "month", count: 10 } },
  ];
}

// ---------- full research run ----------
export interface StartArgs {
  company: string;
  domain?: string;
  category: string;
  watchlist?: string[];
  user: string;
}

export function startResearch(args: StartArgs & { domain: string }): RunState {
  const cat = getCategory(args.category);
  const key = accountKey(args.domain, cat.id);
  const run = new Run(key, "research");
  void runResearch(run, { ...args, domain: args.domain }).catch((e) => {
    run.state.status = "error";
    run.state.error = (e as Error).message;
    run.trace("error", (e as Error).message);
    // demo safety: fall back to last good snapshot if one exists
    const snap = latestSnapshot(key);
    if (snap) {
      run.state.partial = { ...snap };
      run.trace("info", `Live run failed; showing cached snapshot from ${snap.created_at}`);
    }
  });
  return run.state;
}

async function runResearch(run: Run, args: StartArgs & { domain: string }) {
  const cat = getCategory(args.category);
  const watchlist = args.watchlist?.length ? args.watchlist : [...cat.incumbents, ...cat.challengers];
  const { company, domain, user } = args;
  const key = run.state.key;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const prev = latestSnapshot(key);
  upsertAccount({ key, company, domain, category: cat.id, ...(getAccount(key)?.owner ? {} : { owner: user, claimed_at: now }) });

  const P = run.state.partial;
  Object.assign(P, { key, company, domain, category: cat.id, watchlist, evidence: [] as Evidence[], created_by: user });
  const evidence = P.evidence as Evidence[];
  const push = (e: Evidence) => {
    evidence.push(e);
    const r = reconcile(evidence, cat);
    Object.assign(P, r, score(evidence, r));
  };

  // 1. Plan
  const plan = buildQueries(company, domain, cat, watchlist);
  run.trace("plan", `${plan.length} queries planned for ${company} (${domain}); caps: ${CAPS.search} searches, ${CAPS.pages} pages, ${CAPS.research} research`, plan.map((p) => `${p.label}: ${p.query}`));

  // 2. Search (parallel)
  const results = await Promise.all(plan.map((p) => search(run, p.query, p.opts).then((r) => r.map((x) => ({ ...x, _label: p.label })))));
  const seen = new Map<string, SearchResult & { _label: string }>();
  for (const r of results.flat()) {
    const u = r.url.split("#")[0];
    if (!seen.has(u)) seen.set(u, r);
  }
  const toolTerms = [...watchlist, ...cat.keywords, "observability", "monitoring", "migrat"].map((t) => t.toLowerCase());
  const mentionsTool = (r: SearchResult) => {
    const hay = `${r.url} ${r.title ?? ""} ${r.description ?? ""} ${(r.snippets ?? []).join(" ")}`.toLowerCase();
    return toolTerms.some((t) => hay.includes(t));
  };
  const relevant = [...seen.values()].filter((r) => {
    const src = guessSource(r.url, domain, cat);
    const aboutCo = hostOf(r.url).endsWith(domain) || mentionsCompany(r, company, domain);
    // own-domain consumer pages (stores, menus) are noise unless they mention the category
    const aggregatorSearch = /indeed\.com\/(q-|jobs\?)|dice\.com\/jobs\/q-|glassdoor\.com\/Job\/|linkedin\.com\/jobs\/search|ziprecruiter\.com\/(jobs-search|Jobs\/)/i.test(r.url);
    if (aggregatorSearch) return false;
    const vendorCareers = Object.values(cat.vendorDomains).some((v) => hostOf(r.url).endsWith(v)) && /careers|jobs/.test(r.url);
    const toolAsCompany = watchlist.some((w) => new RegExp(`/(co|company|companies)/${w.toLowerCase().replace(/\s+/g, "-")}`).test(r.url.toLowerCase()));
    if (vendorCareers || toolAsCompany) return false;
    const ownConsumerPage = hostOf(r.url).endsWith(domain) && !/blog|engineering|careers|jobs|press|news|tech/.test(r.url);
    const vendorNotAboutCo = src === "vendor_case_study" && !`${r.url} ${r.title ?? ""}`.toLowerCase().includes(company.toLowerCase().split(" ")[0]);
    return aboutCo && !ownConsumerPage && !vendorNotAboutCo && (mentionsTool(r) || src === "job_post" || src === "vendor_case_study");
  });
  relevant.sort((a, b) => priority(a.url, domain, cat) - priority(b.url, domain, cat));
  run.trace("search", `${seen.size} unique URLs, ${relevant.length} mention ${company}`);

  // 3. Read: homepage HTML + top pages as markdown (in parallel)
  const homepage = `https://${domain.startsWith("www.") ? domain : "www." + domain}`;
  const topUrls = relevant.slice(0, CAPS.pages - 1).map((r) => r.url);
  const [homeArr, ...pageBatches] = await Promise.all([
    contents(run, [homepage], ["html"]),
    ...chunk(topUrls, 10).map((b) => contents(run, b, ["markdown"])),
  ]);

  // 4. Detect (deterministic)
  let html = homeArr?.[0]?.html ?? "";
  if (!/<script/i.test(html)) {
    run.trace("detect", "Contents HTML had no <script> tags; falling back to a plain fetch for script detection");
    html = await plainFetch(homepage, run);
  }
  const siteEv = detectScripts(html, homepage, today, cat);
  run.trace("detect", siteEv.length ? `Site code: ${siteEv.map((e) => e.tool).join(", ")}` : "No known scripts detected on homepage", siteEv.map((e) => e.evidence_quote));
  siteEv.forEach(push);

  // 5. Extract (LLM) + verify quotes
  const ageByUrl = new Map(relevant.map((r) => [r.url, r.page_age]));
  const pages = pageBatches.flat().map((p) => ({ ...p, page_age: ageByUrl.get(p.url) }));
  run.trace("extract", `Extracting from ${pages.length} pages`);
  const ex = await extractPages(run, pages, company, domain, cat, watchlist, push);
  run.trace("extract", `Anti-hallucination check: ${ex.dropped} items dropped (quote not found verbatim, or not about ${company})`);
  P.dropped = ex.dropped;
  P.llm_tokens = ex.tokens;

  // 6. Reconcile + conflict check via Answer
  const r = reconcile(evidence, cat);
  run.trace("reconcile", `${r.tools.length} tools, ${r.migrations.length} migration signals, ${r.conflicts.length} conflicts`);
  if (r.conflicts[0]) {
    const c = r.conflicts[0];
    const tool = c.tool.split(" vs ")[0];
    const a = await answer(run, `Does ${company} currently use ${tool} for observability, or have they moved to another tool? Cite dated sources.`);
    if (a) c.check = { answer: a.answer, citations: a.citations };
  }
  const s = score(evidence, r);
  Object.assign(P, r, s);
  run.trace("score", `Displacement Score ${s.score} (${s.verdict})`, s.breakdown);

  // 7. Brief (Research API)
  let brief: Snapshot["brief"] = null;
  if (evidence.length) {
    run.trace("brief", "Research API (standard) writing the why-now brief… 10–30s");
    const lines = evidence.slice(0, 15).map((e) => `- ${e.tool} [${e.signal_type}, ${e.source_type}, ${e.date}]: "${e.evidence_quote}" (${e.url})`).join("\n");
    try {
      const rr = await research(
        run,
        `You are briefing an account executive at a challenger observability vendor (${cat.challengers.join(", ")}) about ${company} (${domain}).\n` +
          `Evidence we already verified:\n${lines}\n\n` +
          `Write a short "why now" brief (under 200 words): what ${company} runs for observability today, any signs of change (migrations, hiring, cost pressure, re-platforming, leadership change, incidents), and the best angle for outreach. Cite every claim. Say plainly where evidence is thin.`
      );
      brief = { content: String(rr.output.content), sources: rr.output.sources.map((s) => ({ url: s.url, title: s.title })) };
    } catch (e) {
      brief = { content: "", sources: [], error: (e as Error).message };
    }
  } else {
    run.trace("brief", "Skipped Research: no evidence found (we don't brief on nothing)");
  }
  P.brief = brief;

  // 8. Snapshot
  const snap: Snapshot = {
    key, company, domain, category: cat.id, watchlist,
    created_at: new Date().toISOString(), created_by: user,
    evidence, ...r, ...s, brief,
    page_hashes: ex.hashes,
    seen_urls: [...new Set([...(prev?.seen_urls ?? []), ...relevant.map((x) => x.url)])],
    cost: run.state.cost,
    calls: run.state.calls.filter((c) => c.api !== "llm" && c.api !== "http").length,
    llm_tokens: ex.tokens,
    dropped: ex.dropped,
    trace: run.state.trace,
  };
  saveSnapshot(snap);
  upsertAccount({ key, last_researched_at: snap.created_at, last_researched_by: user, last_checked_at: snap.created_at, score: s.score, verdict: s.verdict });
  run.trace("save", `Snapshot saved: ${evidence.length} evidence items, $${run.state.cost.toFixed(3)} You.com spend`);
  run.state.partial = snap;
  run.state.status = "done";
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ---------- watch pass ----------
export function startWatch(key: string, user: string): RunState {
  const run = new Run(key, "watch");
  void runWatch(run, key, user).catch((e) => {
    run.state.status = "error";
    run.state.error = (e as Error).message;
    run.trace("error", (e as Error).message);
  });
  return run.state;
}

async function runWatch(run: Run, key: string, user: string) {
  const prev = latestSnapshot(key);
  if (!prev) throw new Error("No snapshot yet. Run research first.");
  const cat = getCategory(prev.category);
  const { company, domain, watchlist } = prev;
  const now = new Date().toISOString();
  const orList = watchlist.map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" OR ");
  run.trace("watch", `Lightweight pass since ${prev.created_at}`);

  const qs = [
    { query: `${company} ${orList}`, opts: { include_domains: JOB_DOMAINS, freshness: "week", count: 10 } },
    { query: `"${company}" job ${orList}`, opts: { freshness: "week", count: 10 } },
    { query: `"${company}" ${orList} ${cat.keywords[0]}`, opts: { freshness: "week", count: 10 } },
  ];
  const res = (await Promise.all(qs.map((q) => search(run, q.query, q.opts)))).flat();
  const seen = new Set(prev.seen_urls);
  const fresh = [...new Map(res.map((r) => [r.url, r])).values()].filter((r) => !seen.has(r.url) && (hostOf(r.url).endsWith(domain) || mentionsCompany(r, company, domain)));
  run.trace("watch", `${fresh.length} new URLs since last snapshot`);

  // Re-read previously seen job pages (live, no cache) to catch removals and edits.
  const jobUrls = prev.hiring.map((e) => e.url).filter((u, i, a) => a.indexOf(u) === i).slice(0, 8);
  const [rechecked, newPages] = await Promise.all([
    jobUrls.length ? contents(run, jobUrls, ["markdown"], { max_age: 0 }) : Promise.resolve([] as PageContent[]),
    fresh.length ? contents(run, fresh.slice(0, 10).map((r) => r.url), ["markdown"]) : Promise.resolve([] as PageContent[]),
  ]);

  const changes: ChangeItem[] = [];
  const mk = (kind: ChangeItem["kind"], message: string, url?: string, evidence?: Evidence): ChangeItem => ({ id: crypto.randomUUID(), key, at: now, by: user, kind, message, url, evidence });

  const got = new Map(rechecked.map((p) => [p.url, p]));
  for (const u of jobUrls) {
    const p = got.get(u);
    const text = p?.markdown ?? "";
    if (!p || !text || /no longer (accepting|available)|job (has been )?(closed|filled)|page not found|404/i.test(text.slice(0, 3000))) {
      changes.push(mk("removed_posting", `Job posting appears removed or closed`, u));
    } else if (prev.page_hashes[u]?.startsWith("tools:")) {
      const before = new Set(prev.page_hashes[u].slice(6).split(",").filter(Boolean));
      const after = new Set(toolFingerprint(text, watchlist).slice(6).split(",").filter(Boolean));
      const added = [...after].filter((t) => !before.has(t));
      const removed = [...before].filter((t) => !after.has(t));
      if (added.length || removed.length)
        changes.push(mk("changed_text", `Job post ${added.length ? `now mentions ${added.join(", ")}` : ""}${added.length && removed.length ? "; " : ""}${removed.length ? `no longer mentions ${removed.join(", ")}` : ""}`, u));
    }
  }

  const ageByUrl = new Map(fresh.map((r) => [r.url, r.page_age]));
  const ex = await extractPages(run, newPages.map((p) => ({ ...p, page_age: ageByUrl.get(p.url) })), company, domain, cat, watchlist, () => {});
  const known = new Set(prev.tools.map((t) => t.tool));
  for (const u of fresh.map((r) => r.url)) changes.push(mk("new_url", `New page found`, u));
  for (const e of ex.evidence) {
    changes.push(mk(known.has(e.tool) ? "new_url" : "new_tool", `${known.has(e.tool) ? "New evidence" : "New tool"}: ${e.tool} (${e.signal_type.replace("_", " ")}, ${e.source_type.replace("_", " ")})`, e.url, e));
  }
  // de-dupe "New page found" entries that also produced evidence
  const withEv = new Set(ex.evidence.map((e) => e.url));
  const finalChanges = changes.filter((c) => !(c.message === "New page found" && c.url && withEv.has(c.url)));
  if (!finalChanges.length) finalChanges.push(mk("no_change", "No changes since last check"));
  addChanges(finalChanges);
  run.state.changes = finalChanges;

  // Merge into a new snapshot if evidence changed.
  const merged = [...prev.evidence, ...ex.evidence.filter((e) => !prev.evidence.some((p) => p.id === e.id))];
  const r = reconcile(merged, cat);
  const s = score(merged, r);
  let brief = prev.brief;
  const strongNew = ex.evidence.some((e) => e.confidence !== "Inferred");
  if (strongNew) {
    run.trace("brief", "New Strong/Confirmed signal → refreshing why-now brief");
    try {
      const rr = await research(run, `Update the "why now" observability brief for ${company} (${domain}) given this new evidence:\n${ex.evidence.map((e) => `- ${e.tool}: "${e.evidence_quote}" (${e.url}, ${e.date})`).join("\n")}\nUnder 150 words, cite every claim.`);
      brief = { content: String(rr.output.content), sources: rr.output.sources.map((x) => ({ url: x.url, title: x.title })) };
    } catch (e) {
      run.trace("error", `Research refresh failed: ${(e as Error).message}`);
    }
  } else {
    run.trace("brief", "No new Strong/Confirmed signal → Research not called");
  }
  const snap: Snapshot = {
    ...prev, evidence: merged, ...r, ...s, brief,
    created_at: now, created_by: user,
    page_hashes: { ...prev.page_hashes, ...ex.hashes, ...Object.fromEntries(rechecked.filter((p) => p.markdown).map((p) => [p.url, toolFingerprint(p.markdown!, watchlist)])) },
    seen_urls: [...new Set([...prev.seen_urls, ...fresh.map((x) => x.url)])],
    // cumulative: what it cost to build this snapshot (used for "saved by sharing")
    cost: prev.cost + run.state.cost,
    calls: prev.calls + run.state.calls.filter((c) => c.api !== "llm" && c.api !== "http").length,
    trace: run.state.trace,
  };
  saveSnapshot(snap);
  upsertAccount({ key, last_checked_at: now, score: s.score, verdict: s.verdict });
  run.state.partial = snap;
  run.trace("save", `${finalChanges.length} change items; $${run.state.cost.toFixed(4)} spent`);
  run.state.status = "done";
}
