"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/lib/config";
import type { Account } from "@/lib/types";
import { Logo, UserPicker, VerdictBadge, ago, useUser } from "./ui";

type Decision =
  | { decision: "owned_by_other"; key: string; account: Account; has_snapshot: boolean }
  | { decision: "fresh"; key: string; account: Account; saved_calls: number; saved_cost: number }
  | { decision: "started"; key: string; run_id: string }
  | { error: string };

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useUser();
  const [company, setCompany] = useState("");
  const [domain, setDomain] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].id);
  const cat = CATEGORIES.find((c) => c.id === category)!;
  const [watchlist, setWatchlist] = useState<string[]>([...cat.incumbents, ...cat.challengers]);
  const [newTool, setNewTool] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Decision | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [savings, setSavings] = useState({ calls: 0, cost: 0, reuses: 0 });

  const load = () =>
    fetch("/api/accounts").then((r) => r.json()).then((d) => {
      setAccounts(d.accounts);
      setSavings(d.savings);
    });
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function submit(force = false) {
    setBusy(true);
    setNotice(null);
    const r = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, domain, category, watchlist, user, force }),
    });
    const d: Decision = await r.json();
    setBusy(false);
    if ("error" in d) return setNotice(d);
    if (d.decision === "started") return router.push(`/account/${encodeURIComponent(d.key)}?run=${d.run_id}`);
    if (d.decision === "fresh") return router.push(`/account/${encodeURIComponent(d.key)}?shared=1&saved=${d.saved_calls}&cost=${d.saved_cost}`);
    setNotice(d);
  }

  async function requestHandoff(key: string) {
    await fetch(`/api/accounts/${encodeURIComponent(key)}/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, action: "request" }) });
    setNotice(null);
    load();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <Logo />
        <UserPicker user={user} setUser={setUser} />
      </header>

      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Who's about to switch, and why now.</h1>
        <p className="mt-2 max-w-2xl text-zinc-600">
          Enter a target account. Tripwire reads live job posts, vendor case studies, engineering blogs, news and the company's own site code, then shows what they run, whether they're moving, and the receipts for every claim.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-6 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto_auto]"
        >
          <input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (e.g. DoorDash)" className="rounded-md border border-zinc-300 px-3 py-2" />
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain (optional, e.g. doordash.com)" className="rounded-md border border-zinc-300 px-3 py-2" />
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              const c = CATEGORIES.find((x) => x.id === e.target.value)!;
              setWatchlist([...c.incumbents, ...c.challengers]);
            }}
            className="rounded-md border border-zinc-300 px-3 py-2"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <button disabled={busy} className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
            {busy ? "Checking…" : "Research"}
          </button>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Watchlist</span>
            {watchlist.map((t) => (
              <span key={t} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${cat.incumbents.includes(t) ? "border-zinc-400 bg-zinc-100" : "border-red-200 bg-red-50 text-red-800"}`}>
                {t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => setWatchlist(watchlist.filter((x) => x !== t))} className="text-zinc-400 hover:text-zinc-900">×</button>
              </span>
            ))}
            <input
              value={newTool}
              onChange={(e) => setNewTool(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTool.trim()) {
                  e.preventDefault();
                  setWatchlist([...watchlist, newTool.trim()]);
                  setNewTool("");
                }
              }}
              placeholder="+ add tool"
              className="w-28 rounded border border-dashed border-zinc-300 px-2 py-0.5 text-xs"
            />
            <span className="text-xs text-zinc-400">grey = incumbent · red = challenger</span>
          </div>
        </form>

        {notice && "error" in notice && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{notice.error}</p>}
        {notice && "decision" in notice && notice.decision === "owned_by_other" && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span>
              <b>{notice.account.owner}</b> is covering <b>{notice.account.company}</b>, last researched {ago(notice.account.last_researched_at)}.
            </span>
            {notice.has_snapshot && (
              <a href={`/account/${encodeURIComponent(notice.key)}?shared=1`} className="rounded bg-amber-900 px-3 py-1 font-medium text-white">View shared research</a>
            )}
            <button onClick={() => requestHandoff(notice.key)} className="rounded border border-amber-900 px-3 py-1 font-medium">Request handoff</button>
            <button onClick={() => submit(true)} className="ml-auto text-xs underline">Run anyway</button>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-900">Team accounts</h2>
          <p className="text-sm text-zinc-600">
            Shared research saved <b>{savings.calls}</b> API calls (~<b>${savings.cost.toFixed(2)}</b>) across {savings.reuses} reuses
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Verdict</th>
                <th className="px-4 py-2">Last researched</th>
                <th className="px-4 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No accounts yet. Research one above.</td>
                </tr>
              )}
              {accounts.map((a) => (
                <tr key={a.key} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <a href={`/account/${encodeURIComponent(a.key)}`} className="font-medium text-zinc-900 hover:underline">{a.company || a.domain}</a>
                    <span className="ml-2 text-xs text-zinc-400">{a.domain}</span>
                  </td>
                  <td className="px-4 py-2">
                    {a.owner ?? "—"}
                    {a.handoff_requested_by && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">handoff → {a.handoff_requested_by}</span>}
                  </td>
                  <td className="px-4 py-2"><VerdictBadge verdict={a.verdict} score={a.score} /></td>
                  <td className="px-4 py-2 text-zinc-600">{ago(a.last_researched_at)}</td>
                  <td className="px-4 py-2 text-zinc-600">{a.last_researched_by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
