import { NextResponse } from "next/server";
import { addRegion, orgMapStatus, startOrgMap } from "@/lib/orgmap";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  return NextResponse.json(orgMapStatus(key));
}

// POST { user, region?, add_only? } — build the map (1 Research call), or only one region,
// or (add_only) just add an empty region the user can run later.
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  const { user = "anonymous", region, add_only = false } = await req.json().catch(() => ({}));
  if (region && add_only) {
    addRegion(key, region, user);
    return NextResponse.json({ added: region });
  }
  if (region) addRegion(key, region, user);
  startOrgMap(key, user, region || undefined);
  return NextResponse.json({ started: true });
}
