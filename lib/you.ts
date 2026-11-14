// You.com client. Every call is timed, cost-estimated, cap-checked and logged to the run context.
import { CAPS, PRICE } from "./config";
import type { ApiCallLog } from "./types";

const SEARCH_URL = "https://ydc-index.io/v1/search";
const CONTENTS_URL = "https://ydc-index.io/v1/contents";
const RESEARCH_URL = "https://api.you.com/v1/research";
const ANSWER_URL = "https://api.you.com/v1/answer";

export interface CallSink {
  log(c: ApiCallLog): void;
  count(api: ApiCallLog["api"]): number;
  pages(): number;
}

export class CapExceeded extends Error {}

function key() {
  const k = process.env.YDC_API_KEY;
  if (!k) throw new Error("YDC_API_KEY is not set");
  return k;
}

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-API-Key": key(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface SearchResult {
  url: string;
  title?: string;
  description?: string;
  snippets?: string[];
  page_age?: string;
}

export interface SearchOpts {
  count?: number;
  freshness?: "day" | "week" | "month" | "year" | string;
  include_domains?: string[];
}

export async function search(sink: CallSink, query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  if (sink.count("search") >= CAPS.search) throw new CapExceeded(`search cap (${CAPS.search}) reached`);
  const t0 = Date.now();
  try {
    const body: Record<string, unknown> = { query, count: opts.count ?? 10 };
    if (opts.freshness) body.freshness = opts.freshness;
    if (opts.include_domains?.length) body.include_domains = opts.include_domains;
    const r = await post<{ results?: { web?: SearchResult[] } }>(SEARCH_URL, body, 15000);
    const web = r.results?.web ?? [];
    sink.log({ api: "search", ms: Date.now() - t0, cost: PRICE.search, ok: true, note: `${query} → ${web.length}` });
    return web;
  } catch (e) {
    sink.log({ api: "search", ms: Date.now() - t0, cost: PRICE.search, ok: false, note: `${query}: ${(e as Error).message}` });
    return [];
  }
}

export interface PageContent {
  url: string;
  title?: string;
  html?: string | null;
  markdown?: string | null;
}

export async function contents(
  sink: CallSink,
  urls: string[],
  formats: ("html" | "markdown")[] = ["markdown"],
  opts: { max_age?: number } = {}
): Promise<PageContent[]> {
  const room = CAPS.pages - sink.pages();
  if (room <= 0) throw new CapExceeded(`page cap (${CAPS.pages}) reached`);
  const batch = urls.slice(0, room);
  if (!batch.length) return [];
  const t0 = Date.now();
  try {
    const body: Record<string, unknown> = { urls: batch, formats, crawl_timeout: 10 };
    if (opts.max_age !== undefined) body.max_age = opts.max_age;
    const r = await post<PageContent[]>(CONTENTS_URL, body, 25000);
    sink.log({ api: "contents", ms: Date.now() - t0, cost: batch.length * PRICE.contentsPage, ok: true, note: `${batch.length} urls → ${r.length} pages`, pages: batch.length });
    return r;
  } catch (e) {
    sink.log({ api: "contents", ms: Date.now() - t0, cost: batch.length * PRICE.contentsPage, ok: false, note: (e as Error).message, pages: batch.length });
    return [];
  }
}

export interface ResearchResult {
  output: { content: string; content_type: string; sources: { url: string; title?: string; snippets?: string[] }[] };
  warnings?: string[];
}

export async function research(sink: CallSink, input: string): Promise<ResearchResult> {
  if (sink.count("research") >= CAPS.research) throw new CapExceeded("research cap reached");
  const t0 = Date.now();
  try {
    const r = await post<ResearchResult>(RESEARCH_URL, { input, research_effort: "standard" }, 90000);
    sink.log({ api: "research", ms: Date.now() - t0, cost: PRICE.research, ok: true, note: `${r.output?.sources?.length ?? 0} sources` });
    return r;
  } catch (e) {
    sink.log({ api: "research", ms: Date.now() - t0, cost: PRICE.research, ok: false, note: (e as Error).message });
    throw e;
  }
}

export interface AnswerResult {
  answer: string;
  citations: { source: string; excerpts: string[] }[];
}

export async function answer(sink: CallSink, query: string): Promise<AnswerResult | null> {
  if (sink.count("answer") >= CAPS.answer) return null;
  const t0 = Date.now();
  try {
    const r = await post<AnswerResult>(ANSWER_URL, { query }, 30000);
    sink.log({ api: "answer", ms: Date.now() - t0, cost: PRICE.answer, ok: true, note: query });
    return r;
  } catch (e) {
    sink.log({ api: "answer", ms: Date.now() - t0, cost: PRICE.answer, ok: false, note: (e as Error).message });
    return null;
  }
}
