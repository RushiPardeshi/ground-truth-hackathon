"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Logo, UserPicker, VerdictBadge, ago, useUser } from "./ui";

interface ToolChip { tool: string; confidence: string; stale: boolean; url?: string }
interface Row {
  key: string; company: string; domain: string; owner: string | null; score: number | null; verdict: string | null;
  last_researched_at: string | null; last_researched_by: string | null; last_checked_at: string | null; handoff_requested_by: string | null;
  researched: boolean; incumbents: ToolChip[]; challengers: ToolChip[]; top_signal: string | null; hiring: number; receipts: number;
  orgmap: boolean; orgmap_running: boolean; research_status: "running" | "queued" | null; next_refresh: string;
}
interface Column { id: string; name: string; prompt: string; created_by: string }
interface Cell { key: string; column_id: string; value: string; citations: { source: string; excerpts: string[] }[]; at: string; by: string; status: string }
interface OrgTeam { region: string; team: string; tools: { tool: string; evidence: string; source_url: string }[]; people: { name: string; title: string; source_url: string }[] }
interface OrgMapData { teams: OrgTeam[]; sources: { url: string; title?: string }[]; dropped: number; error?: string }

const favicon = (d: string) => `https://you.com/favicon?domain=${d}&size=64`;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function Chip({ t, tone }: { t: ToolChip; tone: "inc" | "chal" }) {
  const cls = tone === "inc" ? "border-zinc-300 bg-zinc-100 text-zinc-800" : "border-red-200 bg-red-50 text-red-800";
  return (
    <a href={t.url} target="_blank" rel="noreferrer" title={`${t.confidence}${t.stale ? " · stale" : ""}`} className={`mr-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:underline ${cls} ${t.stale ? "opacity-50" : ""}`}>
      {t.tool}
      <span className={`h-1.5 w-1.5 rounded-full ${t.confidence === "Confirmed" ? "bg-emerald-500" : t.confidence === "Strong" ? "bg-indigo-500" : "bg-zinc-400"}`} />
    </a>
  );
}

function OrgTree({ row, user }: { row: Row; user: string }) {
  const [data, setData] = useState<{ running: boolean; map: { at: string; by: string; data: OrgMapData } | null } | null>(null);
  const load = useCallback(() => fetch(`/api/accounts/${encodeURIComponent(row.key)}/orgmap`).then((r) => r.json()).then(setData), [row.key]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [data?.running, load]);
  const build = async () => {
    await fetch(`/api/accounts/${encodeURIComponent(row.key)}/orgmap`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user }) });
    load();
  };
  if (!row.researched) return <p className="text-sm text-zinc-500">Run research on this row first. The org map is built on top of verified evidence.</p>;
  const map = data?.map?.data;
  const regions = new Map<string, OrgTeam[]>();
  for (const t of map?.teams ?? []) regions.set(t.region, [...(regions.get(t.region) ?? []), t]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-zinc-900">{row.company} org map</span>
        <span className="text-xs text-zinc-500">regions → teams → tools & people · You.com Research (structured output)</span>
        {data?.map && <span className="text-xs text-zinc-500">built {ago(data.map.at)} by {data.map.by} · {map?.dropped ?? 0} uncited items dropped</span>}
        <button onClick={build} disabled={data?.running} className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50">
          {data?.running ? "Mapping… (10–40s)" : data?.map ? "Refresh map" : "Map org (~$0.05)"}
        </button>
        <a href={`/account/${encodeURIComponent(row.key)}`} className="ml-auto text-xs text-indigo-700 hover:underline">Full account page →</a>
      </div>
      {data?.running && !map && <div className="animate-pulse text-sm text-zinc-500">Research agent is reading job posts, engineering blogs and public profiles…</div>}
      {map?.error && <p className="text-sm text-red-700">Map failed: {map.error}</p>}
      {map && !map.error && map.teams.length === 0 && <p className="text-sm text-zinc-500">No evidence found for teams or people.</p>}
      <div className="space-y-3">
        {[...regions.entries()].map(([region, teams]) => (
          <details key={region} open className="rounded-lg border border-zinc-200 bg-white">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-zinc-900">🌐 {region} <span className="font-normal text-zinc-500">· {teams.length} team{teams.length > 1 ? "s" : ""}</span></summary>
            <div className="space-y-2 px-3 pb-3">
              {teams.map((t, i) => (
                <details key={i} open className="rounded-md border border-zinc-100 bg-zinc-50">
                  <summary className="cursor-pointer select-none px-3 py-1.5 text-sm font-medium text-zinc-800">👥 {t.team} <span className="font-normal text-zinc-500">· {t.tools.length} tools · {t.people.length} people</span></summary>
                  <div className="grid gap-3 px-3 pb-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Software</div>
                      {t.tools.length === 0 && <div className="text-xs text-zinc-400">No evidence found.</div>}
                      {t.tools.map((x, j) => (
                        <div key={j} className="mb-1 text-xs">
                          <a href={x.source_url} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline">{x.tool}</a>
                          <span className="text-zinc-500"> — “{x.evidence.replace(/^[“"']+|[”"']+$/g, "")}” </span>
                          <span className="text-indigo-700">{host(x.source_url)} ↗</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">People (public sources)</div>
                      {t.people.length === 0 && <div className="text-xs text-zinc-400">No evidence found.</div>}
                      {t.people.map((p, j) => (
                        <div key={j} className="mb-1 text-xs">
                          <a href={p.source_url} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline">{p.name}</a>
                          <span className="text-zinc-500"> · {p.title} · </span>
                          <span className="text-indigo-700">{host(p.source_url)} ↗</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export default function Grid() {
  const [user, setUser] = useUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [savings, setSavings] = useState({ calls: 0, cost: 0, reuses: 0 });
  const [refreshDays, setRefreshDays] = useState(30);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"rows" | "column" | null>(null);
  const [entries, setEntries] = useState("");
  const [colName, setColName] = useState("");
  const [colPrompt, setColPrompt] = useState("");
  const [msg, setMsg] = useState("");
  const [cellOpen, setCellOpen] = useState<Cell | null>(null);

  const load = useCallback(() =>
    fetch("/api/grid").then((r) => r.json()).then((d) => {
      setRows(d.rows); setColumns(d.columns); setCells(d.cells); setSavings(d.savings); setRefreshDays(d.refresh_days);
    }), []);
  const busy = rows.some((r) => r.research_status || r.orgmap_running) || cells.some((c) => c.status === "running");
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // deep link: /?open=netflix.com|observability expands that row
    const o = new URLSearchParams(window.location.search).get("open");
    if (o) setOpen(new Set([o]));
  }, []);
  useEffect(() => {
    const t = setInterval(load, busy ? 2000 : 15000);
    return () => clearInterval(t);
  }, [busy, load]);

  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  async function addRows() {
    const list = entries.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    const d = await post("/api/rows", { entries: list, user });
    setMsg(`Added ${d.added.length} row${d.added.length === 1 ? "" : "s"}${d.errors.length ? ` · ${d.errors.join("; ")}` : ""}`);
    setEntries(""); setPanel(null);
    if (d.added.length) await post("/api/grid/research", { keys: d.added, user });
    load();
  }
  async function research(keys: string[], force = false) {
    const d = await post("/api/grid/research", { keys, user, force });
    setMsg(`Researching ${d.queued.length} row(s) live with You.com${d.reused.length ? ` · ${d.reused.length} reused from teammates' recent research (no API calls)` : ""}`);
    load();
  }
  async function addColumn() {
    if (!colPrompt.trim()) return;
    await post("/api/columns", { name: colName || colPrompt.slice(0, 28), prompt: colPrompt, user });
    setColName(""); setColPrompt(""); setPanel(null); load();
  }
  const cellFor = (key: string, col: string) => cells.find((c) => c.key === key && c.column_id === col);
  const toggle = (s: Set<string>, k: string) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const allKeys = rows.map((r) => r.key);
  const target = sel.size ? [...sel] : allKeys;

  return (
    <main className="min-h-screen bg-white">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center gap-3 text-sm">
          <Logo />
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-600">Team workspace</span>
          <span className="text-zinc-300">/</span>
          <span className="font-medium text-zinc-900">Observability accounts</span>
        </div>
        <UserPicker user={user} setUser={setUser} />
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2 text-sm">
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800" title="Each row gets a You.com watch pass when its last check is older than this">⟳ Auto-refresh every {refreshDays} days</span>
        <span className="rounded-md px-2 py-1 text-zinc-600">{rows.length} rows · {columns.length + 6} columns</span>
        <button onClick={() => setPanel(panel === "rows" ? null : "rows")} className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50">+ Add rows</button>
        <button onClick={() => research(target)} disabled={!rows.length} className="rounded-md bg-zinc-900 px-2.5 py-1 font-medium text-white hover:bg-zinc-700 disabled:opacity-40">▷ Run research {sel.size ? `(${sel.size} selected)` : "(all)"}</button>
        <button onClick={() => setPanel(panel === "column" ? null : "column")} className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50">+ Add AI column</button>
        <span className="ml-auto text-xs text-zinc-500">Shared research saved <b>{savings.calls}</b> API calls (~${savings.cost.toFixed(2)}) across {savings.reuses} reuses</span>
      </div>

      {panel === "rows" && (
        <div className="flex flex-wrap items-start gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
          <textarea value={entries} onChange={(e) => setEntries(e.target.value)} rows={3} placeholder={"One per line or comma-separated: netflix.com, Anaplan, coupa.com…"} className="w-full max-w-xl rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" />
          <button onClick={addRows} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Add & research</button>
          <p className="w-full text-xs text-zinc-500">Company names resolve to domains first, so “Walt Disney Co.” and disney.com land on the same shared row.</p>
        </div>
      )}
      {panel === "column" && (
        <div className="flex flex-wrap items-start gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
          <input value={colName} onChange={(e) => setColName(e.target.value)} placeholder="Column name (e.g. Cloud provider)" className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm" />
          <input value={colPrompt} onChange={(e) => setColPrompt(e.target.value)} placeholder="Prompt, e.g. Which cloud provider does {company} run on?" className="min-w-[320px] flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm" />
          <button onClick={addColumn} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Add & run on all rows</button>
          <p className="w-full text-xs text-zinc-500">Each cell is answered live by the You.com Answer API with citations (~$0.005 per cell). Use {"{company}"} and {"{domain}"} in the prompt.</p>
        </div>
      )}
      {msg && <div className="border-b border-zinc-100 bg-indigo-50 px-4 py-1.5 text-xs text-indigo-900">{msg} <button onClick={() => setMsg("")} className="ml-2 underline">dismiss</button></div>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-600">
              <th className="w-10 border-r border-zinc-200 px-2 py-2"><input type="checkbox" checked={sel.size > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(allKeys) : new Set())} /></th>
              <th className="w-8 border-r border-zinc-200 px-2">#</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Company</th>
              <th className="border-r border-zinc-200 px-3 font-medium">⚡ Displacement</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Incumbent stack</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Challengers</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Top signal</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Hiring · receipts</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Owner · refreshed</th>
              {columns.map((c) => (
                <th key={c.id} className="border-r border-zinc-200 px-3 font-medium" title={c.prompt}>
                  <div className="flex items-center gap-1">
                    <span>✦ {c.name}</span>
                    <button onClick={() => post(`/api/columns/${c.id}`, { user, keys: sel.size ? [...sel] : undefined }).then(load)} className="rounded border border-zinc-300 px-1 text-[10px] hover:bg-white" title="Run this column">▷</button>
                    <button onClick={() => fetch(`/api/columns/${c.id}`, { method: "DELETE" }).then(load)} className="text-zinc-400 hover:text-zinc-900" title="Delete column">×</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9 + columns.length} className="px-4 py-10 text-center text-zinc-500">No rows yet. Click “+ Add rows” and paste a few domains.</td></tr>
            )}
            {rows.map((r, i) => (
              <Fragment key={r.key}>
                <tr className={`border-b border-zinc-100 hover:bg-zinc-50 ${open.has(r.key) ? "bg-zinc-50" : ""}`}>
                  <td className="border-r border-zinc-100 px-2 text-center"><input type="checkbox" checked={sel.has(r.key)} onChange={() => setSel(toggle(sel, r.key))} /></td>
                  <td className="border-r border-zinc-100 px-2 text-xs text-zinc-400">{i + 1}</td>
                  <td className="border-r border-zinc-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setOpen(toggle(open, r.key))} className="w-4 text-zinc-500 hover:text-zinc-900" title="Expand org map">{open.has(r.key) ? "▾" : "▸"}</button>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={favicon(r.domain)} alt="" className="h-4 w-4 rounded" />
                      <a href={`/account/${encodeURIComponent(r.key)}`} className="font-medium text-zinc-900 hover:underline">{r.company}</a>
                      <span className="text-xs text-zinc-400">{r.domain}</span>
                    </div>
                  </td>
                  <td className="border-r border-zinc-100 px-3">
                    {r.research_status ? <span className="animate-pulse text-xs text-red-600">● {r.research_status === "running" ? "researching live…" : "queued"}</span> : r.researched ? <VerdictBadge verdict={r.verdict} score={r.score} /> : <button onClick={() => research([r.key])} className="text-xs text-indigo-700 underline">▷ run</button>}
                  </td>
                  <td className="border-r border-zinc-100 px-3">{r.incumbents.length ? r.incumbents.map((t) => <Chip key={t.tool} t={t} tone="inc" />) : r.researched ? <span className="text-xs text-zinc-400">No evidence found</span> : null}</td>
                  <td className="border-r border-zinc-100 px-3">{r.challengers.length ? r.challengers.map((t) => <Chip key={t.tool} t={t} tone="chal" />) : r.researched ? <span className="text-xs text-zinc-400">No evidence found</span> : null}</td>
                  <td className="max-w-[260px] truncate border-r border-zinc-100 px-3 text-xs text-zinc-700" title={r.top_signal ?? ""}>{r.top_signal ?? (r.researched ? <span className="text-zinc-400">—</span> : null)}</td>
                  <td className="border-r border-zinc-100 px-3 text-xs text-zinc-700">{r.researched ? `${r.hiring} posts · ${r.receipts} receipts` : ""}</td>
                  <td className="border-r border-zinc-100 px-3 text-xs text-zinc-600">
                    {r.owner ?? "—"} · {ago(r.last_checked_at || r.last_researched_at)}
                    {r.researched && <div className="text-[10px] text-zinc-400">next auto-refresh {new Date(r.next_refresh).toLocaleDateString()}</div>}
                  </td>
                  {columns.map((c) => {
                    const cell = cellFor(r.key, c.id);
                    return (
                      <td key={c.id} className="max-w-[240px] border-r border-zinc-100 px-3 text-xs">
                        {!cell ? <span className="text-zinc-300">—</span> : cell.status === "running" ? <span className="animate-pulse text-zinc-500">asking You.com…</span> : (
                          <button onClick={() => setCellOpen(cell)} className="block w-full truncate text-left text-zinc-800 hover:underline" title={cell.value}>
                            {cell.value || "Unknown"} {cell.citations.length > 0 && <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] text-indigo-700">{cell.citations.length} src</span>}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {open.has(r.key) && (
                  <tr className="border-b border-zinc-200 bg-zinc-50/60">
                    <td colSpan={9 + columns.length} className="!whitespace-normal px-0 py-4"><div className="sticky left-0 w-[min(1100px,calc(100vw-32px))] px-6"><OrgTree row={r} user={user} /></div></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {cellOpen && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4" onClick={() => setCellOpen(null)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-xs text-zinc-500">{columns.find((c) => c.id === cellOpen.column_id)?.prompt} · answered {ago(cellOpen.at)} for {cellOpen.by}</div>
            <div className="mb-3 text-base font-medium text-zinc-900">{cellOpen.value || "Unknown"}</div>
            <div className="space-y-2">
              {cellOpen.citations.map((c, i) => (
                <div key={i} className="rounded-lg border border-zinc-200 p-2 text-xs">
                  <a href={c.source} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{host(c.source)} ↗</a>
                  {c.excerpts.slice(0, 2).map((x, j) => <blockquote key={j} className="mt-1 border-l-2 border-red-500 pl-2 text-zinc-700">“{x}”</blockquote>)}
                </div>
              ))}
              {cellOpen.citations.length === 0 && <p className="text-xs text-zinc-500">No sources returned, so treat this as unverified.</p>}
            </div>
            <button onClick={() => setCellOpen(null)} className="mt-4 rounded-md border border-zinc-300 px-3 py-1 text-sm">Close</button>
          </div>
        </div>
      )}
    </main>
  );
}
