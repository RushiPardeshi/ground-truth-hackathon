import { NextResponse } from "next/server";
import { getAccount, upsertAccount } from "@/lib/db";
import { accountKey, discoverAccounts, enqueueResearch, resolveDomain } from "@/lib/pipeline";
import { activeWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { tool, limit?, add_rows?, user? } — companies whose Greenhouse/Ashby/Lever postings name the tool.
// With add_rows, verified accounts become sheet rows and get researched.
export async function POST(req: Request) {
  const { tool, limit = 15, add_rows = false, user = "anonymous" } = await req.json();
  if (!tool) return NextResponse.json({ error: "tool required" }, { status: 400 });
  const progress: string[] = [];
  const accounts = await discoverAccounts({ tool, limit, onProgress: (m) => progress.push(m) });
  const added: string[] = [];
  if (add_rows) {
    const wsId = activeWorkspaceId() ?? "observability";
    for (const a of accounts.filter((x) => x.verified_count > 0).slice(0, 10)) {
      try {
        const { domain } = await resolveDomain(a.company, undefined);
        const key = accountKey(domain, wsId);
        const job = a.sample_jobs.find((j) => j.verified);
        if (!getAccount(key)) {
          upsertAccount({
            key, company: a.company, domain, category: wsId, owner: user, claimed_at: new Date().toISOString(),
            meta: JSON.stringify({ industry: `${a.ats} · ${a.job_count} posts`, hq: job?.location ?? null, size: null, why: `Hiring: “${job?.title}” names ${tool} — “${job?.quote?.slice(0, 120)}”` }),
          });
        }
        added.push(key);
      } catch {
        // unresolved company name: skip, never guess a domain
      }
    }
    enqueueResearch(added, user);
  }
  return NextResponse.json({ tool, accounts, added, progress });
}
