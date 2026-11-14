// Workspace = who is selling. Its incumbents (the tools the seller displaces) become the
// watchlist for every account, so the harness works for any seller, not just observability.
// Server-only (uses SQLite).
import { CATEGORIES, type CategoryPreset } from "./config";
import { db } from "./db";

export interface Workspace {
  id: string; // also the account "category" key
  seller_name: string;
  seller_description: string;
  category_label: string;
  incumbents: string[];
  vendor_domains: Record<string, string>;
  keywords: string[];
  created_at: string;
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
}

export function saveWorkspace(w: Workspace) {
  db.prepare("INSERT OR REPLACE INTO workspaces (id, data, created_at) VALUES (?, ?, ?)").run(w.id, JSON.stringify(w), w.created_at);
}

export function listWorkspaces(): Workspace[] {
  return (db.prepare("SELECT data FROM workspaces ORDER BY created_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function getWorkspace(id: string): Workspace | null {
  const r = db.prepare("SELECT data FROM workspaces WHERE id = ?").get(id) as { data: string } | undefined;
  if (r) return JSON.parse(r.data);
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) return null;
  // Built-in preset (incumbents only; challengers are dropped by design).
  return {
    id: c.id, seller_name: "Challenger observability vendor", seller_description: "Observability platform selling against legacy monitoring tools",
    category_label: c.label, incumbents: c.incumbents, vendor_domains: Object.fromEntries(c.incumbents.map((t) => [t, c.vendorDomains[t]]).filter(([, d]) => d)),
    keywords: c.keywords, created_at: "1970-01-01T00:00:00Z",
  };
}

export function getProfile(id: string): CategoryPreset & { seller: string; sellerDescription: string } {
  const w = getWorkspace(id) ?? getWorkspace("observability")!;
  return {
    id: w.id, label: w.category_label, incumbents: w.incumbents, challengers: [],
    vendorDomains: w.vendor_domains, keywords: w.keywords.length ? w.keywords : [w.category_label],
    seller: w.seller_name, sellerDescription: w.seller_description,
  };
}

// ---------- active workspace (shared by the whole team) ----------
db.exec("CREATE TABLE IF NOT EXISTS settings ( k TEXT PRIMARY KEY, v TEXT )");
export function activeWorkspaceId(): string | null {
  const r = db.prepare("SELECT v FROM settings WHERE k = 'active_ws'").get() as { v: string } | undefined;
  return r?.v ?? null;
}
export function setActiveWorkspace(id: string) {
  db.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES ('active_ws', ?)").run(id);
}

// ---------- onboarding: seller description → incumbents + ideal clients (You.com Research) ----------
const ONBOARD_SCHEMA = {
  type: "object",
  properties: {
    seller_name: { type: "string" },
    category_label: { type: "string" },
    incumbents: {
      type: "array",
      items: { type: "object", properties: { tool: { type: "string" }, vendor_domain: { type: ["string", "null"] } }, required: ["tool", "vendor_domain"], additionalProperties: false },
    },
    keywords: { type: "array", items: { type: "string" } },
    ideal_clients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" }, domain: { type: "string" }, industry: { type: "string" },
          hq: { type: ["string", "null"] }, size: { type: ["string", "null"] }, why: { type: "string" },
        },
        required: ["company", "domain", "industry", "hq", "size", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["seller_name", "category_label", "incumbents", "keywords", "ideal_clients"],
  additionalProperties: false,
};

export interface IdealClient { company: string; domain: string; industry: string; hq: string | null; size: string | null; why: string }

export async function onboard(description: string, count = 10, sellerName?: string): Promise<{ ws: Workspace; clients: IdealClient[]; sources: { url: string }[] }> {
  const input =
    `A B2B company${sellerName ? ` called ${sellerName}` : ""} describes itself: "${description}".\n` +
    `1) Name the seller (short) and its software category.\n` +
    `2) List the 4-8 incumbent tools its buyers most often already run and that this seller replaces or competes with (the "incumbent stack"), with each vendor's domain. Use the short product name engineers write in job posts (e.g. "Splunk", "CloudWatch", "Elastic", not "Splunk Observability Cloud").\n` +
    `3) Give 3-5 short search keywords for this category (e.g. "observability", "monitoring").\n` +
    `4) Suggest ${count} real, named ideal client companies (not the seller itself, not the incumbents) likely to run those incumbent tools today and worth prospecting, with domain, industry, HQ, approximate employee count and one line on why they fit. Prefer companies with public job posts or engineering blogs.`;
  const r = await fetch("https://api.you.com/v1/research", {
    method: "POST",
    headers: { "X-API-Key": process.env.YDC_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ input, research_effort: "standard", output_schema: ONBOARD_SCHEMA }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Research ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  const c = typeof body.output?.content === "string" ? JSON.parse(body.output.content) : body.output?.content;
  const ws: Workspace = {
    id: slug(sellerName || c.seller_name || description.slice(0, 30)),
    seller_name: sellerName || c.seller_name, seller_description: description, category_label: c.category_label,
    incumbents: c.incumbents.map((x: { tool: string }) => x.tool),
    vendor_domains: Object.fromEntries(c.incumbents.filter((x: { vendor_domain: string | null }) => x.vendor_domain).map((x: { tool: string; vendor_domain: string }) => [x.tool, x.vendor_domain.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "")])),
    keywords: c.keywords ?? [], created_at: new Date().toISOString(),
  };
  saveWorkspace(ws);
  return { ws, clients: c.ideal_clients ?? [], sources: body.output?.sources ?? [] };
}

// Discover more clients for the chat bar ("find 5 fintechs like Stripe").
export async function discoverClients(ws: Workspace, ask: string, count = 5): Promise<IdealClient[]> {
  const schema = { type: "object", properties: { ideal_clients: ONBOARD_SCHEMA.properties.ideal_clients }, required: ["ideal_clients"], additionalProperties: false };
  const input = `Seller: ${ws.seller_name} (${ws.seller_description}); it displaces ${ws.incumbents.join(", ")}.\nRequest: "${ask}".\nReturn up to ${count} real, named companies that match the request and are likely to run those incumbent tools, with domain, industry, HQ, approximate employee count and why they fit.`;
  const r = await fetch("https://api.you.com/v1/research", {
    method: "POST",
    headers: { "X-API-Key": process.env.YDC_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ input, research_effort: "standard", output_schema: schema }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Research ${r.status}`);
  const c = typeof body.output?.content === "string" ? JSON.parse(body.output.content) : body.output?.content;
  return c?.ideal_clients ?? [];
}
