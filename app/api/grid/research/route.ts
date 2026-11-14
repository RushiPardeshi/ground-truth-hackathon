import { NextResponse } from "next/server";
import { FRESH_HOURS } from "@/lib/config";
import { getAccount, recordSaving, latestSnapshot } from "@/lib/db";
import { enqueueResearch, queue } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// POST { keys, user, force? } — research rows; rows researched < 6 h ago are reused, not re-run.
export async function POST(req: Request) {
  const { keys = [], user = "anonymous", force = false } = await req.json();
  const run: string[] = [];
  const reused: string[] = [];
  for (const key of keys as string[]) {
    const a = getAccount(key);
    const s = latestSnapshot(key);
    const fresh = a?.last_researched_at && Date.now() - new Date(a.last_researched_at).getTime() < FRESH_HOURS * 3600_000;
    if (!force && s && fresh) {
      recordSaving(key, user, s.calls, s.cost);
      reused.push(key);
    } else run.push(key);
  }
  enqueueResearch(run, user);
  return NextResponse.json({ queued: run, reused });
}

export async function GET() {
  return NextResponse.json({ active: [...queue.active.keys()], pending: queue.pending.map((p) => p.key) });
}
