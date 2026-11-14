import { NextResponse } from "next/server";
import { runColumn } from "@/lib/columns";
import { deleteColumn, listColumns, updateColumn } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST { user, keys? } — (re)run a prompt column for all rows or the given row keys.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const col = listColumns().find((c) => c.id === id);
  if (!col) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { user = "anonymous", keys } = await req.json().catch(() => ({}));
  return NextResponse.json({ running_rows: runColumn(col, user, keys) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  deleteColumn((await ctx.params).id);
  return NextResponse.json({ ok: true });
}

// PATCH { name, prompt, user, rerun? } — edit a column; re-runs every row by default.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const col = listColumns().find((c) => c.id === id);
  if (!col) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { name = col.name, prompt = col.prompt, user = "anonymous", rerun = true } = await req.json();
  updateColumn(id, name, prompt);
  const next = { ...col, name, prompt };
  return NextResponse.json({ column: next, running_rows: rerun && prompt !== col.prompt ? runColumn(next, user) : 0 });
}
