import { STALE_MONTHS, type CategoryPreset } from "./config";
import type { Confidence, Conflict, Evidence, MigrationSignal, ScoreItem, Snapshot, SourceType, ToolSummary } from "./types";

const RANK: Record<Confidence, number> = { Confirmed: 3, Strong: 2, Inferred: 1 };

export function confidenceFor(source: SourceType, url: string, domain: string): Confidence {
  if (source === "site_code" || source === "vendor_case_study" || source === "filing") return "Confirmed";
  if (source === "news" && hostOf(url).endsWith(domain)) return "Confirmed"; // company's own announcement
  if (source === "job_post" || source === "eng_blog") return "Strong";
  return "Inferred";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isStale(date: string): boolean {
  const d = new Date(date).getTime();
  if (!isFinite(d)) return false;
  return Date.now() - d > STALE_MONTHS * 30.4 * 24 * 3600 * 1000;
}

function monthsAgo(date: string): number {
  const d = new Date(date).getTime();
  return isFinite(d) ? (Date.now() - d) / (30.4 * 24 * 3600 * 1000) : 999;
}

export function roleOf(tool: string, cat: CategoryPreset): ToolSummary["role"] {
  if (cat.incumbents.some((t) => t.toLowerCase() === tool.toLowerCase())) return "incumbent";
  if (cat.challengers.some((t) => t.toLowerCase() === tool.toLowerCase())) return "challenger";
  return "other";
}

export function canonicalTool(name: string, watchlist: string[]): string {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const w of watchlist) {
    const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (n === k || n.startsWith(k) || k.startsWith(n)) return w;
  }
  if (n.includes("grafana") || n.includes("loki") || n.includes("tempo") || n.includes("mimir")) return "Grafana";
  if (n.includes("signalfx")) return "Splunk";
  return name.trim();
}

export function reconcile(evidence: Evidence[], cat: CategoryPreset) {
  const byTool = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (!byTool.has(e.tool)) byTool.set(e.tool, []);
    byTool.get(e.tool)!.push(e);
  }
  const tools: ToolSummary[] = [...byTool.entries()].map(([tool, ev]) => {
    ev.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const best = ev.reduce((m, e) => (RANK[e.confidence] > RANK[m] ? e.confidence : m), "Inferred" as Confidence);
    return { tool, role: roleOf(tool, cat), confidence: best, latest_date: ev[0]?.date ?? "", stale: ev.every((e) => e.stale), evidence: ev };
  });
  tools.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || (b.latest_date || "").localeCompare(a.latest_date || ""));

  // Migration signals: explicit migrate language, or older incumbent evidence + newer challenger evidence.
  const migrations: MigrationSignal[] = [];
  const explicit = evidence.filter((e) => e.signal_type === "migrating_from" || e.signal_type === "migrating_to");
  for (const e of explicit) {
    migrations.push({
      from: e.signal_type === "migrating_from" ? e.tool : undefined,
      to: e.signal_type === "migrating_to" ? e.tool : undefined,
      description: e.signal_type === "migrating_from" ? `Moving off ${e.tool}` : `Moving onto ${e.tool}`,
      evidence: [e],
    });
  }
  const inc = tools.filter((t) => t.role === "incumbent");
  const chal = tools.filter((t) => t.role === "challenger");
  for (const i of inc) {
    const iOld = i.evidence[i.evidence.length - 1];
    for (const c of chal) {
      const cNew = c.evidence[0];
      if (iOld && cNew && cNew.date > iOld.date && monthsAgo(cNew.date) < 12 && !migrations.some((m) => m.from === i.tool && m.to === c.tool)) {
        migrations.push({
          from: i.tool,
          to: c.tool,
          description: `${i.tool} evidence (${iOld.date}) is older than newer ${c.tool} evidence (${cNew.date}). Possible move from ${i.tool} to ${c.tool}.`,
          evidence: [iOld, cNew],
        });
      }
    }
  }

  // Conflicts: same tool both "uses" and "migrating_from"; or incumbent + challenger both claimed in current use.
  const conflicts: Conflict[] = [];
  for (const t of tools) {
    const uses = t.evidence.find((e) => e.signal_type === "uses" && !e.stale);
    const leaving = t.evidence.find((e) => e.signal_type === "migrating_from");
    if (uses && leaving) conflicts.push({ tool: t.tool, description: `Evidence says ${t.tool} is in use, and other evidence says they are moving off it.`, a: uses, b: leaving });
  }
  for (const i of inc) {
    const iu = i.evidence.find((e) => !e.stale && e.signal_type !== "migrating_from");
    for (const c of chal) {
      const cu = c.evidence.find((e) => !e.stale && (e.signal_type === "uses" || e.signal_type === "hiring_for"));
      if (iu && cu && conflicts.length < 4) {
        conflicts.push({ tool: `${i.tool} vs ${c.tool}`, description: `Current evidence for both ${i.tool} (incumbent) and ${c.tool} (challenger). They may run both, or be mid-migration.`, a: iu, b: cu });
      }
    }
  }

  const hiring = evidence.filter((e) => e.source_type === "job_post");
  return { tools, migrations, conflicts, hiring };
}

export function score(
  evidence: Evidence[],
  r: ReturnType<typeof reconcile>
): { score: number; verdict: Snapshot["verdict"]; breakdown: ScoreItem[] } {
  const b: ScoreItem[] = [];
  evidence = evidence.filter((e) => e.category !== "other");
  if (!evidence.length) return { score: 0, verdict: "No evidence", breakdown: [{ label: "No evidence found", points: 0 }] };
  const inc = r.tools.filter((t) => t.role === "incumbent" && !t.stale);
  const incConfirmed = inc.some((t) => t.confidence !== "Inferred");
  if (incConfirmed) b.push({ label: `Incumbent in place (${inc.map((t) => t.tool).join(", ")})`, points: 30 });
  else if (inc.length) b.push({ label: `Incumbent inferred (${inc.map((t) => t.tool).join(", ")})`, points: 15 });
  if (r.migrations.some((m) => m.evidence.some((e) => e.signal_type.startsWith("migrating")))) b.push({ label: "Explicit migration language", points: 30 });
  else if (r.migrations.length) b.push({ label: "Incumbent → challenger timeline shift", points: 15 });
  const recentHiring = r.hiring.filter((e) => monthsAgo(e.date) < 6);
  if (recentHiring.length) b.push({ label: `Recent relevant hiring (${recentHiring.length} posts)`, points: Math.min(20, 10 + 5 * (recentHiring.length - 1)) });
  if (evidence.some((e) => e.signal_type === "evaluating")) b.push({ label: "Actively evaluating tools", points: 15 });
  const chalStrong = r.tools.filter((t) => t.role === "challenger" && t.confidence !== "Inferred" && !t.stale);
  if (chalStrong.length && !inc.length) b.push({ label: `Already on a challenger (${chalStrong.map((t) => t.tool).join(", ")})`, points: -10 });
  if (evidence.every((e) => e.stale)) b.push({ label: "Only stale evidence (>18 months)", points: -20 });
  const s = Math.max(0, Math.min(100, b.reduce((n, x) => n + x.points, 0)));
  const verdict = s >= 60 ? "Hot" : s >= 30 ? "Warm" : "Cold";
  return { score: s, verdict, breakdown: b };
}
