import { NextResponse } from "next/server";
import { createColumn, runColumn } from "@/lib/columns";
import { getAccount, upsertAccount } from "@/lib/db";
import { accountKey, enqueueResearch, normalizeDomain, resolveDomain } from "@/lib/pipeline";
import { activeWorkspaceId, discoverClients, getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// The sheet's chat bar. Deliberately narrow harness: every action ends in rows whose incumbent
// stack gets researched with evidence, or a column answered with citations.
//   "add column Cloud: Which cloud does {company} run on?"  → prompt column
//   "add OpenAI, anthropic.com and Stripe"                 → rows (+ live research)
//   anything else, e.g. "find 5 fintechs like Stripe"       → You.com Research finds matching companies
export async function POST(req: Request) {
  const { message = "", user = "anonymous" } = await req.json();
  const text = String(message).trim();
  const wsId = activeWorkspaceId() ?? "observability";
  const ws = getWorkspace(wsId)!;
  if (!text) return NextResponse.json({ reply: "Say what to add or find." });

  const col = text.match(/^(?:add|new|create)\s+(?:a\s+)?column\s+["“]?([^:"”]+?)["”]?\s*[:—-]\s*(.+)$/i);
  if (col) {
    const c = createColumn(col[1].trim(), col[2].trim(), user);
    const n = runColumn(c, user);
    return NextResponse.json({ reply: `Added column “${c.name}”. Asking You.com for ${n} rows (cited answers).` });
  }

  const add = text.match(/^(?:add|track|research)\s+(.+)$/i);
  const looksLikeList = add && !/\b(companies|like|similar|that|which|in the|startups|more)\b/i.test(add[1]);
  if (add && looksLikeList) {
    const names = add[1].split(/,|\band\b|\n/).map((s) => s.trim().replace(/[.!]$/, "")).filter(Boolean).slice(0, 15);
    const added: string[] = [];
    const failed: string[] = [];
    for (const n of names) {
      try {
        const isDomain = /\.[a-z]{2,}$/i.test(n) && !n.includes(" ");
        const { domain } = await resolveDomain(n, isDomain ? n : undefined);
        const key = accountKey(domain, wsId);
        if (!getAccount(key)) upsertAccount({ key, company: isDomain ? domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : n, domain, category: wsId, owner: user, claimed_at: new Date().toISOString() });
        added.push(key);
      } catch {
        failed.push(n);
      }
    }
    enqueueResearch(added, user);
    return NextResponse.json({ reply: `Added ${added.map((k) => k.split("|")[0]).join(", ") || "nothing"}${failed.length ? ` (couldn't resolve: ${failed.join(", ")})` : ""}. Researching their ${ws.incumbents.slice(0, 3).join("/")}… stack live.`, added });
  }

  try {
    const clients = await discoverClients(ws, text, 5);
    const keys: string[] = [];
    for (const c of clients) {
      const domain = normalizeDomain(c.domain);
      if (!domain.includes(".")) continue;
      const key = accountKey(domain, wsId);
      if (!getAccount(key)) upsertAccount({ key, company: c.company, domain, category: wsId, owner: user, claimed_at: new Date().toISOString(), meta: JSON.stringify({ industry: c.industry, hq: c.hq, size: c.size, why: c.why }) });
      keys.push(key);
    }
    enqueueResearch(keys, user);
    return NextResponse.json({ reply: keys.length ? `Found ${clients.map((c) => c.company).join(", ")}. Added as rows and researching their incumbent stack.` : "You.com didn't find companies matching that. Try naming them: “add Stripe, Plaid”.", added: keys });
  } catch (e) {
    return NextResponse.json({ reply: `Search failed: ${(e as Error).message}` });
  }
}
