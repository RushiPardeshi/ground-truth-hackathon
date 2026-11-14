import { NextResponse } from "next/server";
import { getProfile as getCategory, activeWorkspaceId } from "@/lib/workspace";
import { getAccount, upsertAccount } from "@/lib/db";
import { accountKey, resolveDomain } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// POST { entries: ["netflix.com", "Anaplan", ...], category, user } — add rows to the shared sheet
// (no research yet; run the "Research" column to enrich). Existing rows are left untouched.
export async function POST(req: Request) {
  const { entries = [], category = activeWorkspaceId() ?? "observability", user = "anonymous" } = await req.json();
  const cat = getCategory(category);
  const added: string[] = [];
  const errors: string[] = [];
  for (const raw of (entries as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 50)) {
    try {
      const { domain } = await resolveDomain(raw, /\.[a-z]{2,}$/i.test(raw) ? raw : undefined);
      const key = accountKey(domain, cat.id);
      if (!getAccount(key)) {
        const company = /\.[a-z]{2,}$/i.test(raw) ? domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : raw;
        upsertAccount({ key, company, domain, category: cat.id, owner: user, claimed_at: new Date().toISOString() });
        added.push(key);
      }
    } catch (e) {
      errors.push(`${raw}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json({ added, errors });
}
