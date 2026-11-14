"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, ChangeItem, Conflict, Evidence, RunState, Snapshot, ToolSummary } from "@/lib/types";
import { Logo, UserPicker, VerdictBadge, ago, useUser } from "../../ui";

const SOURCE_ICON: Record<string, string> = { job_post: "💼", vendor_case_study: "🏷️", eng_blog: "🛠️", news: "📰", filing: "📄", site_code: "</>", other: "🔗" };
const SOURCE_LABEL: Record<string, string> = { job_post: "Job post", vendor_case_study: "Vendor case study", eng_blog: "Eng blog", news: "News", filing: "Filing", site_code: "Site code", other: "Web" };

function host(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

function ConfBadge({ c }: { c: string }) {
  const cls = c === "Confirmed" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : c === "Strong" ? "bg-indigo-100 text-indigo-800 border-indigo-200" : "bg-zinc-100 text-zinc-600 border-zinc-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{c}</span>;
}

function Receipt({ e, compact = false }: { e: Evidence; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-zinc-200 bg-white p-3 ${e.stale ? "opacity-50" : ""}`}>
      <blockquote className={`border-l-2 border-red-500 pl-2 text-zinc-800 ${compact ? "text-xs" : "text-sm"}`}>“{e.evidence_quote}”</blockquote>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span title={SOURCE_LABEL[e.source_type]}>{SOURCE_ICON[e.source_type]} {SOURCE_LABEL[e.source_type]}</span>
        <span>{e.date}{e.date_kind === "fetched" ? " (fetched)" : ""}</span>
        {e.stale && <span className="rounded bg-zinc-200 px-1">stale &gt;18mo</span>}
        <span className="rounded bg-zinc-100 px-1">{e.signal_type.replace("_", " ")}</span>
        <a href={e.url} target="_blank" rel="noreferrer" className="truncate text-indigo-700 hover:underline">{host(e.url)} ↗</a>
      </div>
    </div>
  );
}

function ToolCard({ t }: { t: ToolSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${t.stale ? "border-zinc-200 opacity-60" : "border-zinc-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-zinc-900">{t.tool}</div>
          <div className="text-xs text-zinc-500">{t.role} · latest {t.latest_date} · {t.evidence.length} source{t.evidence.length > 1 ? "s" : ""}</div>
        </div>
        <ConfBadge c={t.confidence} />
      </div>
      <div className="mt-3"><Receipt e={t.evidence[0]} compact /></div>
      {t.evidence.length > 1 && (
        <button onClick={() => setOpen(!open)} className="mt-2 text-xs text-indigo-700 hover:underline">{open ? "Hide" : `+${t.evidence.length - 1} more receipts`}</button>
      )}
      {open && <div className="mt-2 space-y-2">{t.evidence.slice(1).map((e) => <Receipt key={e.id} e={e} compact />)}</div>}
    </div>
  );
}

function Section({ title, children, right, empty }: { title: string; children?: React.ReactNode; right?: React.ReactNode; empty?: boolean }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        {right}
      </div>
      {empty ? <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">No evidence found.</p> : children}
    </section>
  );
}

// Minimal markdown: paragraphs, bullets, bold, headings, [n] citations → source links.
function Markdown({ text, sources }: { text: string; sources: { url: string; title?: string }[] }) {
  const inline = (s: string, k: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|\[\[?\d+(?:,\s*\d+)*\]\]?)/g);
    return parts.map((p, i) => {
      if (/^\*\*/.test(p)) return <b key={k + i}>{p.slice(2, -2)}</b>;
      const m = p.match(/^\[\[?([\d,\s]+)\]\]?$/);
      if (m) return m[1].split(",").map((n) => {
        const src = sources[Number(n.trim()) - 1];
        return src ? <a key={k + i + n} href={src.url} target="_blank" rel="noreferrer" title={src.title || src.url} className="mx-0.5 rounded bg-indigo-50 px-1 text-xs text-indigo-700 hover:underline">{n.trim()}</a> : <span key={k + i + n}>[{n}]</span>;
      });
      return <span key={k + i}>{p}</span>;
    });
  };
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-zinc-800">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*]\s/.test(l))) return <ul key={i} className="list-disc pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s/, ""), `${i}-${j}`)}</li>)}</ul>;
        if (/^#+\s/.test(b)) return <h3 key={i} className="font-semibold">{b.replace(/^#+\s/, "")}</h3>;
        return <p key={i}>{inline(b, String(i))}</p>;
      })}
    </div>
  );
}

function ConflictRow({ c }: { c: Conflict }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="mb-2 text-sm font-medium text-amber-900">⚠ {c.tool}: {c.description}</div>
      <div className="grid gap-3 md:grid-cols-2">
        <Receipt e={c.a} compact />
        <Receipt e={c.b} compact />
      </div>
      {c.check && (
        <div className="mt-3 rounded-lg bg-white p-3 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Answer API check</div>
          <Markdown text={c.check.answer} sources={c.check.citations.map((x) => ({ url: x.source }))} />
        </div>
      )}
    </div>
  );
}

export default function AccountView({ accountKey, runId, shared, savedCalls, savedCost, showTrace = false }: { accountKey: string; runId?: string; shared: boolean; savedCalls: number; savedCost: number; showTrace?: boolean }) {
  const [user, setUser] = useUser();
  const [account, setAccount] = useState<Account | null>(null);
  const [snap, setSnap] = useState<Partial<Snapshot> | null>(null);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  const [activeRun, setActiveRun] = useState<string | undefined>(runId);
  const [auto, setAuto] = useState(false);
  const [intervalMin, setIntervalMin] = useState(10);
  const [traceOpen, setTraceOpen] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const lastCheckBefore = useRef<string | null>(null);

  const loadAccount = useCallback(async () => {
    const r = await fetch(`/api/accounts/${encodeURIComponent(accountKey)}`);
    if (!r.ok) return setLoadErr("Account not found yet.");
    const d = await r.json();
    setAccount(d.account);
    setChanges(d.changes);
    if (d.snapshot) setSnap((cur) => (activeRun && cur ? cur : d.snapshot));
  }, [accountKey, activeRun]);

  useEffect(() => { loadAccount(); }, [loadAccount]);

  // Poll the active run for streaming partial results.
  useEffect(() => {
    if (!activeRun) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/runs/${activeRun}`);
      if (!r.ok) { setActiveRun(undefined); return; }
      const s: RunState = await r.json();
      if (stop) return;
      setRun(s);
      if (s.partial && Object.keys(s.partial).length) setSnap(s.partial);
      if (s.status === "running") setTimeout(tick, 1000);
      else { setActiveRun(undefined); loadAccount(); }
    };
    tick();
    return () => { stop = true; };
  }, [activeRun, loadAccount]);

  const check = useCallback(async () => {
    lastCheckBefore.current = snap?.created_at ?? null;
    const r = await fetch(`/api/accounts/${encodeURIComponent(accountKey)}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user }) });
    const d = await r.json();
    if (d.run_id) setActiveRun(d.run_id);
  }, [accountKey, user, snap?.created_at]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { if (!activeRun) check(); }, intervalMin * 60_000);
    return () => clearInterval(t);
  }, [auto, intervalMin, check, activeRun]);

  async function rerun() {
    if (!account) return;
    const r = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: account.company, domain: account.domain, category: account.category, user, force: true }) });
    const d = await r.json();
    if (d.run_id) setActiveRun(d.run_id);
  }

  async function handoff(action: "accept" | "claim" | "request") {
    await fetch(`/api/accounts/${encodeURIComponent(accountKey)}/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, action }) });
    loadAccount();
  }

  const running = run?.status === "running";
  const failedToCache = run?.status === "error" && snap?.created_at;
  const s = snap ?? {};
  const evidence = s.evidence ?? [];
  const obsTools = (s.tools ?? []).filter((t) => t.role !== "other" || t.evidence.some((e) => e.category !== "other"));
  const otherTools = (s.tools ?? []).filter((t) => !obsTools.includes(t));
  const cost = run?.cost ?? s.cost ?? 0;
  const traceItems = run?.trace ?? s.trace ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Logo />
        <UserPicker user={user} setUser={setUser} />
      </header>

      {loadErr && !snap && <p className="text-zinc-500">{loadErr}</p>}

      {/* Header */}
      <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{s.company || account?.company || accountKey.split("|")[0]}</h1>
            <div className="mt-1 text-sm text-zinc-500">
              {s.domain || account?.domain} · owner <b className="text-zinc-700">{account?.owner ?? "—"}</b> · last checked {ago(account?.last_checked_at)} · researched by {account?.last_researched_by ?? "—"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {running && <span className="animate-pulse rounded-full bg-red-600 px-2 py-0.5 font-medium text-white">● LIVE {run?.kind === "watch" ? "watch pass" : "research"}…</span>}
              {!running && run?.status === "done" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">Live run · {new Date(s.created_at ?? Date.now()).toLocaleTimeString()}</span>}
              {shared && !run && <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-800">Shared research from {ago(s.created_at)} by {s.created_by}{savedCalls ? ` — saved ${savedCalls} API calls (~$${savedCost.toFixed(3)})` : " — no API calls made"}</span>}
              {!shared && !run && s.created_at && <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">Saved snapshot · {ago(s.created_at)}</span>}
              {failedToCache && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">⚠ Live run failed ({run?.error}) — showing CACHED data from {ago(s.created_at)}</span>}
              {account?.handoff_requested_by && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Handoff requested by {account.handoff_requested_by}</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Displacement Score</div>
            <div className="text-5xl font-semibold tabular-nums text-zinc-900">{s.score ?? "–"}</div>
            <VerdictBadge verdict={s.verdict} score={s.score} />
            <div className="mt-2 text-xs text-zinc-500">This run: ${cost.toFixed(3)} You.com · {run?.calls.filter((c) => c.api !== "llm" && c.api !== "http").length ?? s.calls ?? 0} calls</div>
          </div>
        </div>
        {s.breakdown && s.breakdown.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {s.breakdown.map((b) => (
              <span key={b.label} className={`rounded-md border px-2 py-1 text-xs ${b.points >= 0 ? "border-zinc-200 bg-zinc-50 text-zinc-700" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
                <b className="tabular-nums">{b.points >= 0 ? "+" : ""}{b.points}</b> {b.label}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={check} disabled={running || !s.created_at} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40">Check for changes</button>
          <button onClick={rerun} disabled={running} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40">Re-run full research</button>
          <label className="ml-2 flex items-center gap-1 text-sm text-zinc-600">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-check every
            <input type="number" min={1} value={intervalMin} onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value)))} className="w-14 rounded border border-zinc-300 px-1" /> min
          </label>
          {account && !account.owner && <button onClick={() => handoff("claim")} className="text-sm text-indigo-700 underline">Claim account</button>}
          {account && account.owner && account.owner !== user && !account.handoff_requested_by && <button onClick={() => handoff("request")} className="text-sm text-indigo-700 underline">Request handoff</button>}
          {account?.owner === user && account.handoff_requested_by && <button onClick={() => handoff("accept")} className="text-sm text-indigo-700 underline">Hand off to {account.handoff_requested_by}</button>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <Section title="Migration & buying signals" empty={!running && !(s.migrations?.length)}>
            <div className="space-y-3">
              {(s.migrations ?? []).map((m, i) => (
                <div key={i} className="rounded-xl border border-red-200 bg-red-50/40 p-4">
                  <div className="mb-2 font-medium text-red-900">{m.from && m.to ? `${m.from} → ${m.to}` : m.description}</div>
                  {m.from && m.to && <div className="mb-2 text-sm text-red-900/80">{m.description}</div>}
                  <div className="grid gap-2 md:grid-cols-2">{m.evidence.map((e) => <Receipt key={e.id} e={e} compact />)}</div>
                </div>
              ))}
              {running && !(s.migrations?.length) && <p className="text-sm text-zinc-500">Looking…</p>}
            </div>
          </Section>

          <Section title="Detected stack" right={<span className="text-xs text-zinc-500">{evidence.length} verified receipts · {s.dropped ?? 0} dropped by quote check</span>} empty={!running && !obsTools.length}>
            <div className="grid gap-3 sm:grid-cols-2">{obsTools.map((t) => <ToolCard key={t.tool} t={t} />)}</div>
            {otherTools.length > 0 && (
              <div className="mt-3 text-xs text-zinc-500">
                Also on their site (other categories):{" "}
                {otherTools.map((t) => <a key={t.tool} href={t.evidence[0].url} target="_blank" rel="noreferrer" className="mr-2 rounded bg-zinc-100 px-1.5 py-0.5 hover:underline" title={t.evidence[0].evidence_quote}>{t.tool}</a>)}
              </div>
            )}
          </Section>

          <Section title="Hiring signals" empty={!running && !(s.hiring?.length)}>
            <div className="space-y-2">
              {(s.hiring ?? []).map((e) => (
                <div key={e.id} className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <a href={e.url} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline">{e.title || host(e.url)}</a>
                    <div className="truncate text-xs text-zinc-500">“{e.evidence_quote}”</div>
                  </div>
                  <div className="shrink-0 text-xs text-zinc-500">{e.tool} · {e.date}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Conflicts" empty={!running && !(s.conflicts?.length)}>
            <div className="space-y-3">{(s.conflicts ?? []).map((c, i) => <ConflictRow key={i} c={c} />)}</div>
          </Section>

          <Section title="Why now" right={<span className="text-xs text-zinc-500">You.com Research API · standard</span>}>
            {s.brief?.content ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <Markdown text={s.brief.content} sources={s.brief.sources} />
                {s.brief.sources.length > 0 && (
                  <ol className="mt-3 list-decimal space-y-0.5 border-t border-zinc-100 pl-5 pt-3 text-xs text-zinc-500">
                    {s.brief.sources.map((x, i) => <li key={i}><a href={x.url} target="_blank" rel="noreferrer" className="hover:underline">{x.title || x.url}</a></li>)}
                  </ol>
                )}
              </div>
            ) : running ? (
              <div className="animate-pulse rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Research API runs after evidence collection (10–30s)…</div>
            ) : s.brief?.error ? (
              <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">Brief unavailable: {s.brief.error}</p>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">No evidence found, so no brief was written.</p>
            )}
          </Section>
        </div>

        <aside>
          <Section title="Change feed">
            {run?.kind === "watch" && run.changes && <p className="mb-2 text-xs text-zinc-500">What's new since {ago(lastCheckBefore.current)}</p>}
            <div className="space-y-2">
              {changes.length === 0 && <p className="text-sm text-zinc-500">No checks yet. Press “Check for changes”.</p>}
              {changes.map((c) => (
                <div key={c.id} className="rounded-lg border border-zinc-200 bg-white p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                    <span className={`rounded px-1.5 ${c.kind === "new_tool" ? "bg-red-100 text-red-800" : c.kind === "removed_posting" ? "bg-amber-100 text-amber-800" : c.kind === "no_change" ? "bg-zinc-100" : "bg-indigo-100 text-indigo-800"}`}>{c.kind.replace("_", " ")}</span>
                    <span>{ago(c.at)} · {c.by}</span>
                  </div>
                  <div className="mt-1 text-zinc-800">{c.message}</div>
                  {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-indigo-700 hover:underline">{host(c.url)} ↗</a>}
                  {c.evidence && <div className="mt-1 text-xs text-zinc-600">“{c.evidence.evidence_quote}”</div>}
                </div>
              ))}
            </div>
          </Section>

          {/* Agent trace is a debugging view, hidden from users; open with ?trace=1 */}
          {showTrace && <Section title="Agent trace" right={<button onClick={() => setTraceOpen(!traceOpen)} className="text-xs text-zinc-500 underline">{traceOpen ? "hide" : "show"}</button>}>
            {traceOpen && (
              <div className="max-h-[560px] overflow-y-auto rounded-xl bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                {traceItems.length === 0 && <div className="text-zinc-500">No trace.</div>}
                {traceItems.map((t, i) => (
                  <div key={i} className={t.step === "error" ? "text-red-400" : t.message.startsWith("✗") ? "text-amber-400" : ""}>
                    <span className="text-zinc-500">{(t.t / 1000).toFixed(1)}s</span> <span className="text-emerald-400">{t.step}</span> {t.message}
                  </div>
                ))}
                {running && <div className="animate-pulse text-zinc-500">…</div>}
              </div>
            )}
          </Section>}
        </aside>
      </div>
    </main>
  );
}
