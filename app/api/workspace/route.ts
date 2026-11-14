import { NextResponse } from "next/server";
import { activeWorkspaceId, getWorkspace, listWorkspaces, setActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const id = activeWorkspaceId();
  return NextResponse.json({ active: id ? getWorkspace(id) : null, workspaces: listWorkspaces() });
}

// POST { id } switch workspace; { id, incumbents } edit the incumbent stack.
export async function POST(req: Request) {
  const { id, incumbents } = await req.json();
  const ws = getWorkspace(id);
  if (!ws) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (Array.isArray(incumbents)) {
    const { saveWorkspace } = await import("@/lib/workspace");
    saveWorkspace({ ...ws, incumbents, created_at: ws.created_at === "1970-01-01T00:00:00Z" ? new Date().toISOString() : ws.created_at });
  }
  setActiveWorkspace(id);
  return NextResponse.json({ active: getWorkspace(id) });
}
