import { NextResponse } from "next/server";
import { cycleRunning, runCycle } from "@/lib/scheduler";
import { activeWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// POST { user, force? } → start a refresh cycle now (in the background). force=true refreshes
// every row in scope, not only the ones that are due.
export async function POST(req: Request) {
  const ws = new URL(req.url).searchParams.get("ws") || activeWorkspaceId() || "observability";
  const { user = "anonymous", force = true } = await req.json().catch(() => ({}));
  if (cycleRunning(ws)) return NextResponse.json({ started: false, note: "A refresh is already running" });
  void runCycle(ws, user, force);
  return NextResponse.json({ started: true });
}
