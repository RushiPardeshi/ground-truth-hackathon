import { NextResponse } from "next/server";
import { FRESH_HOURS } from "@/lib/config";
import { getProfile as getCategory, activeWorkspaceId } from "@/lib/workspace";
import { getAccount, latestSnapshot, recordSaving } from "@/lib/db";
import { accountKey, resolveDomain, startResearch } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// POST { company, domain?, category, watchlist?, user, force? }
// Returns a coordination decision before spending any API calls.
export async function POST(req: Request) {
  const body = await req.json();
  const { company, category = activeWorkspaceId() ?? "observability", watchlist, user = "anonymous", force = false } = body;
  if (!company && !body.domain) return NextResponse.json({ error: "company or domain required" }, { status: 400 });
  let domain: string;
  try {
    domain = (await resolveDomain(company || body.domain, body.domain)).domain;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
  const cat = getCategory(category);
  const key = accountKey(domain, cat.id);
  const acct = getAccount(key);
  const snap = latestSnapshot(key);

  if (!force && acct?.owner && acct.owner !== user) {
    return NextResponse.json({ decision: "owned_by_other", key, account: acct, has_snapshot: !!snap });
  }
  if (!force && snap && acct?.last_researched_at) {
    const ageH = (Date.now() - new Date(acct.last_researched_at).getTime()) / 3600_000;
    if (ageH < FRESH_HOURS) {
      recordSaving(key, user, snap.calls, snap.cost);
      return NextResponse.json({ decision: "fresh", key, account: acct, saved_calls: snap.calls, saved_cost: snap.cost });
    }
  }
  const run = startResearch({ company: company || domain, domain, category: cat.id, watchlist, user });
  return NextResponse.json({ decision: "started", key, run_id: run.id });
}
