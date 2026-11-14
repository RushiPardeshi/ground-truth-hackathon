// Shared evidence schema. Every claim shown in the UI is one of these.

export type SignalType = "uses" | "evaluating" | "migrating_from" | "migrating_to" | "hiring_for";
export type SourceType = "job_post" | "vendor_case_study" | "eng_blog" | "news" | "filing" | "site_code" | "other";
export type Confidence = "Confirmed" | "Strong" | "Inferred";

export interface Evidence {
  id: string;
  tool: string;
  category: string;
  signal_type: SignalType;
  evidence_quote: string; // verbatim, verified to appear in the source text
  url: string;
  title?: string;
  source_type: SourceType;
  date: string; // ISO date
  date_kind: "published" | "fetched";
  confidence: Confidence;
  stale: boolean;
}

export interface ToolSummary {
  tool: string;
  role: "incumbent" | "challenger" | "other";
  confidence: Confidence;
  latest_date: string;
  stale: boolean; // all evidence stale
  evidence: Evidence[];
}

export interface Conflict {
  tool: string;
  description: string;
  a: Evidence;
  b: Evidence;
  check?: { answer: string; citations: { source: string; excerpts: string[] }[] };
}

export interface MigrationSignal {
  from?: string;
  to?: string;
  description: string;
  evidence: Evidence[];
}

export interface ScoreItem {
  label: string;
  points: number;
}

export interface Brief {
  content: string;
  sources: { url: string; title?: string }[];
  error?: string;
}

export interface TraceEvent {
  t: number; // ms since run start
  step: "plan" | "search" | "read" | "detect" | "extract" | "reconcile" | "score" | "brief" | "save" | "watch" | "error" | "info";
  message: string;
  detail?: unknown;
}

export interface ApiCallLog {
  api: "search" | "contents" | "research" | "answer" | "llm" | "http";
  ms: number;
  cost: number; // USD estimate (You.com list price); LLM is 0 here, tokens tracked separately
  ok: boolean;
  note?: string;
  tokens?: number;
  pages?: number;
}

export interface Snapshot {
  key: string;
  company: string;
  domain: string;
  category: string;
  watchlist: string[];
  created_at: string;
  created_by: string;
  evidence: Evidence[];
  tools: ToolSummary[];
  migrations: MigrationSignal[];
  hiring: Evidence[];
  conflicts: Conflict[];
  score: number;
  verdict: "Hot" | "Warm" | "Cold" | "No evidence";
  breakdown: ScoreItem[];
  brief: Brief | null;
  page_hashes: Record<string, string>; // url -> sha1 of text
  seen_urls: string[];
  cost: number;
  calls: number;
  llm_tokens: number;
  dropped: number;
  trace: TraceEvent[];
}

export interface ChangeItem {
  id: string;
  key: string;
  at: string;
  by: string;
  kind: "new_url" | "new_tool" | "removed_posting" | "changed_text" | "no_change";
  message: string;
  url?: string;
  evidence?: Evidence;
}

export interface Account {
  key: string;
  company: string;
  domain: string;
  category: string;
  owner: string | null;
  claimed_at: string | null;
  last_researched_at: string | null;
  last_researched_by: string | null;
  last_checked_at: string | null;
  score: number | null;
  verdict: string | null;
  handoff_requested_by: string | null;
  meta?: string | null; // JSON: { industry, hq, size, why } from onboarding
}

export interface RunState {
  id: string;
  key: string;
  kind: "research" | "watch";
  status: "running" | "done" | "error";
  started_at: number;
  trace: TraceEvent[];
  calls: ApiCallLog[];
  cost: number;
  partial: Partial<Snapshot>;
  changes?: ChangeItem[];
  error?: string;
}
