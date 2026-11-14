import { NextResponse } from "next/server";
import { getOrgMap, latestSnapshot, listAccounts, listCells, listColumns, totalSavings } from "@/lib/db";
import { orgMapStatus } from "@/lib/orgmap";
import { queue } from "@/lib/pipeline";
import { REFRESH_DAYS, ensureScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

// One call returns the whole shared sheet: rows, built-in columns, prompt columns and cells.
export async function GET() {
  ensureScheduler();
  const accounts = listAccounts();
  const rows = accounts.map((a) => {
    const s = latestSnapshot(a.key);
    const obs = (s?.tools ?? []).filter((t) => t.role !== "other");
    return {
      ...a,
      researched: !!s,
      incumbents: obs.filter((t) => t.role === "incumbent").map((t) => ({ tool: t.tool, confidence: t.confidence, stale: t.stale, url: t.evidence[0]?.url })),
      challengers: obs.filter((t) => t.role === "challenger").map((t) => ({ tool: t.tool, confidence: t.confidence, stale: t.stale, url: t.evidence[0]?.url })),
      top_signal: s?.migrations?.[0]?.description ?? null,
      hiring: s?.hiring?.length ?? 0,
      receipts: s?.evidence?.filter((e) => e.category !== "other").length ?? 0,
      orgmap: !!getOrgMap(a.key),
      orgmap_running: orgMapStatus(a.key).running,
      research_status: queue.active.has(a.key) ? "running" : queue.pending.some((p) => p.key === a.key) ? "queued" : null,
      next_refresh: new Date(new Date(a.last_checked_at || a.last_researched_at || Date.now()).getTime() + REFRESH_DAYS * 86400_000).toISOString(),
    };
  });
  return NextResponse.json({ rows, columns: listColumns(), cells: listCells(), savings: totalSavings(), refresh_days: REFRESH_DAYS });
}
