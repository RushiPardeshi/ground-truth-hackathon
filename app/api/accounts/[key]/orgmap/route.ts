import { NextResponse } from "next/server";
import { orgMapStatus, startOrgMap } from "@/lib/orgmap";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  return NextResponse.json(orgMapStatus(key));
}

// POST { user } — build/refresh the regions → teams → tools/people map (1 Research call).
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  const { user = "anonymous" } = await req.json().catch(() => ({}));
  startOrgMap(key, user);
  return NextResponse.json({ started: true });
}
