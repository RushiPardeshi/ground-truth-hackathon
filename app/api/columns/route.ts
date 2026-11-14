import { NextResponse } from "next/server";
import { createColumn, runColumn } from "@/lib/columns";

export const dynamic = "force-dynamic";

// POST { name, prompt, user, run? } — add a prompt column (optionally run it on every row).
export async function POST(req: Request) {
  const { name, prompt, user = "anonymous", run = true } = await req.json();
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  const col = createColumn(name || prompt.slice(0, 30), prompt, user);
  const n = run ? runColumn(col, user) : 0;
  return NextResponse.json({ column: col, running_rows: n });
}
