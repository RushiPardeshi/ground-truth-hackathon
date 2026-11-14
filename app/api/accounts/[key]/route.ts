import { NextResponse } from "next/server";
import { getAccount, latestSnapshot, listChanges } from "@/lib/db";

export const dynamic = "force-dynamic";

// Reading shared research never calls an external API.
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  const account = getAccount(key);
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account, snapshot: latestSnapshot(key), changes: listChanges(key) });
}
