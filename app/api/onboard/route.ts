import { NextResponse } from "next/server";
import { getAccount, upsertAccount } from "@/lib/db";
import { accountKey, enqueueResearch, normalizeDomain } from "@/lib/pipeline";
import { onboard, setActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// POST { description, seller_name?, user, research? } → workspace + 10 ideal-client rows.
export async function POST(req: Request) {
  const { description, seller_name, user = "anonymous", research = true } = await req.json();
  if (!description?.trim()) return NextResponse.json({ error: "Describe your company" }, { status: 400 });
  try {
    const { ws, clients, sources } = await onboard(description, 10, seller_name);
    setActiveWorkspace(ws.id);
    const keys: string[] = [];
    for (const c of clients) {
      const domain = normalizeDomain(c.domain);
      if (!domain.includes(".")) continue;
      const key = accountKey(domain, ws.id);
      if (!getAccount(key)) upsertAccount({ key, company: c.company, domain, category: ws.id, owner: user, claimed_at: new Date().toISOString(), meta: JSON.stringify({ industry: c.industry, hq: c.hq, size: c.size, why: c.why }) });
      keys.push(key);
    }
    if (research) enqueueResearch(keys, user);
    return NextResponse.json({ workspace: ws, rows: keys.length, sources });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
