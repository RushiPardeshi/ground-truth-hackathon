import { NextResponse } from "next/server";
import { startWatch } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// POST { user } — lightweight watch pass; appends to the shared change feed.
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  const { user = "anonymous" } = await req.json().catch(() => ({}));
  const run = startWatch(key, user);
  return NextResponse.json({ run_id: run.id });
}
