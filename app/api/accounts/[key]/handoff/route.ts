import { NextResponse } from "next/server";
import { getAccount, upsertAccount } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST { user, action: "request" | "accept" | "claim" }
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await ctx.params).key);
  const { user, action } = await req.json();
  const a = getAccount(key);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const now = new Date().toISOString();
  if (action === "request") return NextResponse.json(upsertAccount({ key, handoff_requested_by: user }));
  if (action === "accept" && a.owner === user && a.handoff_requested_by)
    return NextResponse.json(upsertAccount({ key, owner: a.handoff_requested_by, claimed_at: now, handoff_requested_by: null }));
  if (action === "claim" && !a.owner) return NextResponse.json(upsertAccount({ key, owner: user, claimed_at: now }));
  return NextResponse.json({ error: "not allowed" }, { status: 409 });
}
