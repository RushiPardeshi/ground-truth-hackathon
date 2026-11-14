import { NextResponse } from "next/server";
import { cycleRunning, dueRows, getRefreshLog, getRefreshSettings, intervalDays, saveRefreshSettings } from "@/lib/scheduler";
import { activeWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const wsOf = (u: URL) => u.searchParams.get("ws") || activeWorkspaceId() || "observability";

// GET → { settings, interval_days, due, running, log }
export async function GET(req: Request) {
  const ws = wsOf(new URL(req.url));
  const settings = getRefreshSettings(ws);
  return NextResponse.json({ workspace: ws, settings, interval_days: intervalDays(settings), due: dueRows(ws, settings).length, running: cycleRunning(ws), log: getRefreshLog(ws) });
}

// POST { ...partial settings, user } → saved settings (shared by the whole team)
export async function POST(req: Request) {
  const ws = wsOf(new URL(req.url));
  const { user = "anonymous", ...patch } = await req.json();
  const allowed = ["enabled", "frequency", "every_days", "refresh_evidence", "refresh_people", "refresh_columns", "discover_new", "discover_per_cycle", "scope", "selected_keys", "max_spend_usd"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  const settings = saveRefreshSettings(ws, clean, user);
  return NextResponse.json({ settings, interval_days: intervalDays(settings), due: dueRows(ws, settings).length });
}
