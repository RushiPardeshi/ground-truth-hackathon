// LLM extraction. The You.com Inference Router needs purchased credits on this key (402),
// so extraction runs on the Anthropic API. Output is schema-constrained, then every quote
// is checked against the page text; anything not found verbatim is dropped.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LLM_MODEL } from "./config";

const ItemSchema = z.object({
  tool: z.string(),
  signal_type: z.enum(["uses", "evaluating", "migrating_from", "migrating_to", "hiring_for"]),
  evidence_quote: z.string(),
  source_type: z.enum(["job_post", "vendor_case_study", "eng_blog", "news", "filing", "other"]),
  about_target_company: z.boolean(),
  published_date: z.string(), // YYYY-MM-DD or "" if unknown
});
const OutSchema = z.object({ items: z.array(ItemSchema) });
export type ExtractedItem = z.infer<typeof ItemSchema>;

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return client;
}

export async function extractFromPage(args: {
  company: string;
  domain: string;
  tools: string[];
  url: string;
  title?: string;
  text: string; // relevant excerpt windows of the page
}): Promise<{ items: ExtractedItem[]; tokens: number }> {
  const prompt = `You extract evidence of which software tools a company uses, from one web page.

Target company: ${args.company} (${args.domain})
Tools to look for: ${args.tools.join(", ")}
Page URL: ${args.url}
Page title: ${args.title ?? ""}

Rules:
- Only report a tool if the page gives evidence about ${args.company}'s OWN usage, evaluation, migration, or hiring. Set about_target_company=false if the page is about a different company (e.g. a job board listing for another employer, a vendor page that only lists many logos, a generic article).
- evidence_quote MUST be copied character-for-character from the page text below, max 25 words. Do not paraphrase, merge sentences, or fix typos.
- signal_type: "uses" = currently uses; "evaluating" = trialing/considering; "migrating_from"/"migrating_to" = explicit move away from / onto a tool; "hiring_for" = a job post requiring experience with the tool.
- source_type: job_post for job listings; vendor_case_study for a vendor's customer story/announcement; eng_blog for the company's engineering blog; news; filing; otherwise other.
- published_date: the page's publish/post date if stated, as YYYY-MM-DD, else "".
- If there is no evidence, return an empty items array. Never guess.

PAGE TEXT:
"""
${args.text}
"""`;

  const res = await anthropic().messages.parse({
    model: LLM_MODEL,
    max_tokens: 4000,
    output_config: { format: zodOutputFormat(OutSchema), effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });
  const tokens = (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);
  return { items: res.parsed_output?.items ?? [], tokens };
}

// --- Quote verification -----------------------------------------------------

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links -> text
    .replace(/[*_`#>|]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteAppears(quote: string, normalizedPage: string): boolean {
  const q = normalizeText(quote).replace(/^["'.\s]+|["'.\s]+$/g, "");
  if (q.length < 8) return false;
  return normalizedPage.includes(q);
}

// Keep only windows of the page around mentions of the tools / migration words, to save tokens.
export function relevantWindows(text: string, terms: string[], radius = 700, maxChars = 12000): string {
  const lower = text.toLowerCase();
  const hits: [number, number][] = [];
  for (const term of terms) {
    const t = term.toLowerCase();
    let i = lower.indexOf(t);
    let n = 0;
    while (i !== -1 && n < 6) {
      hits.push([Math.max(0, i - radius), Math.min(text.length, i + t.length + radius)]);
      i = lower.indexOf(t, i + t.length);
      n++;
    }
  }
  if (!hits.length) return "";
  hits.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([...h]);
  }
  let out = text.slice(0, 600) + "\n...\n"; // page header often holds title/date
  for (const [a, b] of merged) {
    if (out.length > maxChars) break;
    out += text.slice(a, b) + "\n...\n";
  }
  return out.slice(0, maxChars);
}

// --- Rule-based fallback (no LLM). Quotes are sentences taken straight from the page. ---
export function ruleExtract(text: string, company: string, tools: string[], isJobPost: boolean, titleUrl = ""): ExtractedItem[] {
  const clean = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>|]/g, " ");
  const sentences = clean.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 20 && s.length < 400);
  const lowerAll = clean.toLowerCase();
  const co = company.toLowerCase();
  const pageAboutCo = titleUrl.toLowerCase().includes(co) || titleUrl.toLowerCase().includes(co.replace(/\s+/g, ""));
  void lowerAll;
  const out: ExtractedItem[] = [];
  const seen = new Set<string>();
  for (let si = 0; si < sentences.length; si++) {
    const s = sentences[si];
    const l = s.toLowerCase();
    const near = `${sentences[si - 1] ?? ""} ${s} ${sentences[si + 1] ?? ""}`.toLowerCase();
    // Rule path is conservative: the page must be about the company (title/URL) or the company
    // must be named right next to the tool, or it's a job post on the company's board.
    const aboutCo = pageAboutCo || near.includes(co);
    void isJobPost;
    for (const tool of tools) {
      const t = tool.toLowerCase();
      const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (!re.test(l) || seen.has(tool)) continue;
      const te = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Reversed relationships: the tool vendor is the employer, or the tool is the company's customer.
      if (new RegExp(`(within|at|join|joining|about|across) ${te}\\b`).test(l)) continue;
      if (new RegExp(`${te}[^.]{0,80}\\b(use|uses|leverage|leverages|chose|selects?)\\s+${co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(l)) continue;
      if (!/monitor|log|observab|dashboard|metric|alert|trac|apm|telemetry|sre|reliab|incident|experience|tool|stack|pipe|instrument|migrat/.test(l)) continue;
      let signal: ExtractedItem["signal_type"] = isJobPost ? "hiring_for" : "uses";
      const idx = l.indexOf(t);
      const before = l.slice(Math.max(0, idx - 60), idx);
      const after = l.slice(idx, idx + 60);
      if (/(migrat\w*|mov\w* (away )?from|replac\w*|sunset\w*|off of)\s*$/.test(before.trim()) || /\b(from)\s*$/.test(before.trim()) && /migrat|mov/.test(l)) signal = "migrating_from";
      else if (/(migrat\w* to|mov\w* to|switch\w* to|adopt\w*|onto)\s*$/.test(before.trim())) signal = "migrating_to";
      else if (/evaluat|pilot|trial|proof of concept|poc\b/.test(l)) signal = "evaluating";
      void after;
      const words = s.split(" ");
      const quote = words.length > 25 ? words.slice(Math.max(0, words.findIndex((w) => w.toLowerCase().includes(t.split(" ")[0])) - 10)).slice(0, 25).join(" ") : s;
      out.push({ tool, signal_type: signal, evidence_quote: quote, source_type: isJobPost ? "job_post" : "other", about_target_company: aboutCo, published_date: "" });
      seen.add(tool);
    }
  }
  return out;
}
