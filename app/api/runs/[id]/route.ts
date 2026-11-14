import { NextResponse } from "next/server";
import { runs } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = runs.get(id);
  if (!run) return NextResponse.json({ error: "unknown run (server restarted?)" }, { status: 404 });
  return NextResponse.json(run);
}
