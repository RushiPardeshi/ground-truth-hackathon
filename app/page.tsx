"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo, UserPicker, VerdictBadge, ago, useUser } from "./ui";

interface ToolChip { tool: string; confidence: string; stale: boolean; url?: string }
interface Meta { industry?: string; hq?: string | null; size?: string | null; why?: string }
interface Row {
  key: string; company: string; domain: string; score: number | null; verdict: string | null;
  last_researched_at: string | null; last_checked_at: string | null;
  researched: boolean; incumbents: ToolChip[]; hiring: number; receipts: number; meta: Meta | null;
  orgmap: boolean; orgmap_running: boolean; research_status: "running" | "queued" | null; next_refresh: string;
}
interface Column { id: string; name: string; prompt: string; created_by: string }
interface Cell { key: string; column_id: string; value: string; citations: { source: string; excerpts: string[] }[]; at: string; by: string; status: string }
interface Scored { score: number; why: string[] }
interface OrgTool { tool: string; evidence: string; source_url: string; source_type: string; date: string | null; confidence: Scored }
interface OrgPerson { name: string; title: string; city?: string | null; source_url: string; source_type: string; as_of: string | null; confidence: Scored }
interface OrgTeam { region: string; team: string; tools: OrgTool[]; people: OrgPerson[] }
interface OrgMapData { teams: OrgTeam[]; regions: string[]; sources: { url: string }[]; dropped: number; error?: string }
interface Workspace { id: string; seller_name: string; seller_description: string; category_label: string; incumbents: string[] }

const favicon = (d: string) => `https://you.com/favicon?domain=${d}&size=64`;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const post = (url: string, body: unknown, method = "POST") => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const PRESETS = [
  { name: "Datadog-style observability", desc: "We sell cloud observability (metrics, logs, APM, tracing) to engineering and SRE teams." },
  { name: "Snowflake-style data warehouse", desc: "We sell a cloud data warehouse and analytics platform to data engineering teams." },
  { name: "Rippling-style HR & payroll", desc: "We sell all-in-one HR, payroll and IT management software to HR and finance teams." },
  { name: "CrowdStrike-style endpoint security", desc: "We sell endpoint detection and response (EDR) and XDR to security operations teams." },
  { name: "Gong-style revenue intelligence", desc: "We sell call recording and revenue intelligence software to sales teams." },
  { name: "Notion-style docs & wiki", desc: "We sell a connected workspace for docs, wikis and project tracking to whole companies." },
];

function Score({ s, label }: { s: Scored; label: string }) {
  const c = s.score >= 75 ? "bg-emerald-100 text-emerald-800 border-emerald-200" : s.score >= 50 ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-zinc-100 text-zinc-600 border-zinc-200";
  return <span title={`${label}\n${s.why.join("\n")}`} className={`ml-1 inline-block min-w-[34px] rounded border px-1 text-center text-[10px] font-semibold tabular-nums ${c}`}>{s.score}</span>;
}

// ---------------- onboarding ----------------
function Onboarding({ user, onDone, onCancel }: { user: string; onDone: () => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async (d = desc, n = name) => {
    if (!d.trim()) return;
    setBusy(true); setErr("");
    const r = await post("/api/onboard", { description: d, seller_name: n || undefined, user });
    setBusy(false);
    if (r.error) setErr(r.error); else onDone();
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between"><Logo />{onCancel && <button onClick={onCancel} className="text-sm text-zinc-500 underline">Back to sheet</button>}</div>
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">What does your company sell?</h1>
      <p className="mt-2 text-zinc-600">Tripwire works out the incumbent tools your buyers already run, suggests 10 ideal clients, and then finds evidence of who runs those incumbents, team by team. Every claim comes with a source.</p>
      {busy ? (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
          <div className="animate-pulse font-medium text-zinc-900">You.com Research is mapping your market…</div>
          <p className="mt-1 text-sm text-zinc-500">Finding your incumbent stack and 10 ideal clients (about 20–40s). Rows start researching as soon as they appear.</p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => go(p.desc, "")} className="rounded-xl border border-zinc-200 bg-white p-3 text-left hover:border-zinc-400">
                <div className="font-medium text-zinc-900">{p.name}</div>
                <div className="text-xs text-zinc-500">{p.desc}</div>
              </button>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
            <div className="mb-2 text-sm font-medium text-zinc-900">Or describe your own company</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name (optional)" className="mb-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="e.g. We sell AI code review to engineering teams at mid-size SaaS companies, replacing manual review and tools like SonarQube." className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            <button onClick={() => go()} className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Find my ideal clients</button>
          </div>
        </>
      )}
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
    </main>
  );
}

// ---------------- right-side org panel ----------------
function OrgPanel({ row, user, incumbents, onClose }: { row: Row; user: string; incumbents: string[]; onClose: () => void }) {
  const [data, setData] = useState<{ running: boolean; running_region: string | null; map: { at: string; by: string; data: OrgMapData } | null } | null>(null);
  const [newRegion, setNewRegion] = useState("");
  const [regionFilter, setRegionFilter] = useState("All");
  const [copied, setCopied] = useState(false);
  const url = `/api/accounts/${encodeURIComponent(row.key)}/orgmap`;
  const load = useCallback(() => fetch(url).then((r) => r.json()).then(setData), [url]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [data?.running, load]);
  const run = async (region?: string) => { await post(url, { user, region }); load(); };
  const addRegion = async () => {
    if (!newRegion.trim()) return;
    const r = newRegion.trim();
    await post(url, { user, region: r, add_only: true });
    setNewRegion(""); setRegionFilter(r); load();
  };
  const map = data?.map?.data;
  const regions = [...new Set([...(map?.regions ?? []), ...(map?.teams ?? []).map((t) => t.region)])];
  // Flatten to a call list: one row per person (deduped by name, best score kept).
  const leadMap = new Map<string, OrgPerson & { region: string; team: string; teamTools: string[] }>();
  for (const t of map?.teams ?? []) {
    const teamTools = [...new Set(t.tools.map((x) => x.tool))];
    for (const p of t.people) {
      const k = p.name.toLowerCase();
      const cur = leadMap.get(k);
      if (!cur || p.confidence.score > cur.confidence.score) leadMap.set(k, { ...p, region: t.region, team: t.team, teamTools });
    }
  }
  const leads = [...leadMap.values()]
    .filter((l) => regionFilter === "All" || l.region === regionFilter)
    .sort((a, b) => b.confidence.score - a.confidence.score);
  const copyCsv = () => {
    const esc = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Company", "Region", "City", "Team", "Person", "Title", "Still in role (0-100)", "Team uses", "Source"].join(",")];
    for (const l of leads) lines.push([row.company, l.region, l.city, l.team, l.name, l.title, String(l.confidence.score), l.teamTools.join("; "), l.source_url].map(esc).join(","));
    navigator.clipboard.writeText(lines.join("\n")).then(() => setCopied(true));
    setTimeout(() => setCopied(false), 1500);
  };
  const runningRegion = data?.running ? (data.running_region || "all regions") : null;

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-20 flex w-full max-w-[760px] flex-col border-l border-zinc-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-zinc-200 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={favicon(row.domain)} alt="" className="h-5 w-5 rounded" />
            <span className="text-lg font-semibold text-zinc-900">{row.company}</span>
            {row.researched && <VerdictBadge verdict={row.verdict} score={row.score} />}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">{row.domain}{row.meta?.industry ? ` · ${row.meta.industry}` : ""}{row.meta?.size ? ` · ${row.meta.size}` : ""}{row.meta?.hq ? ` · ${row.meta.hq}` : ""}</div>
          {row.incumbents.length > 0 && <div className="mt-1 text-xs text-zinc-600">Runs: {row.incumbents.map((t) => t.tool).join(", ")}</div>}
        </div>
        <button onClick={onClose} className="text-xl leading-none text-zinc-400 hover:text-zinc-900">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!row.researched ? (
          <p className="text-sm text-zinc-500">{row.research_status ? "Researching this company's incumbent stack live…" : "Run research on this row first. Leads are found on top of verified evidence."}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900">People to call</span>
              <span className="text-xs text-zinc-500">{leads.length} lead{leads.length === 1 ? "" : "s"}{data?.map ? ` · found ${ago(data.map.at)} by ${data.map.by} · ${map?.dropped ?? 0} uncited dropped` : ""}</span>
              {leads.length > 0 && <button onClick={copyCsv} className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">{copied ? "Copied ✓" : "Copy CSV"}</button>}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {["All", ...regions].map((r) => (
                <span key={r} className={`inline-flex items-center overflow-hidden rounded-md border text-xs ${regionFilter === r ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700"}`}>
                  <button onClick={() => setRegionFilter(r)} className="px-2 py-1">{r === "All" ? "All regions" : r}</button>
                  <button
                    onClick={() => run(r === "All" ? undefined : r)}
                    disabled={!!data?.running}
                    title={r === "All" ? "Find people in all regions (1 You.com Research call)" : `Find people in ${r} (1 You.com Research call)`}
                    className={`border-l px-1.5 py-1 disabled:opacity-40 ${regionFilter === r ? "border-zinc-700" : "border-zinc-300 hover:bg-zinc-50"}`}
                  >▷</button>
                </span>
              ))}
              <input value={newRegion} onChange={(e) => setNewRegion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRegion()} placeholder="+ region (e.g. North America)" className="w-44 rounded-md border border-dashed border-zinc-300 px-2 py-1 text-xs" />
            </div>

            {map?.error && <p className="mb-2 text-xs text-red-700">Last run failed: {map.error}</p>}
            {runningRegion && <div className="mb-2 animate-pulse text-xs text-indigo-800">You.com Research is finding people in {runningRegion} (public profiles, talks, team pages)… 20–40s</div>}
            {!map && !data?.running && <p className="text-sm text-zinc-500">Press ▷ on a region to find people to call (~$0.05 per run).</p>}

            {leads.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">City</th>
                      <th className="px-2 py-2 font-medium">Team</th>
                      <th className="px-2 py-2 font-medium">Person</th>
                      <th className="px-2 py-2 font-medium">Title</th>
                      <th className="px-2 py-2 font-medium" title="Confidence they're still in this role (from source type and how recent it is)">In role</th>
                      <th className="px-2 py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.name} className="border-t border-zinc-100 align-top hover:bg-zinc-50">
                        <td className="px-2 py-1.5 text-zinc-700">{l.city ?? <span className="text-zinc-400">{l.region}</span>}</td>
                        <td className="px-2 py-1.5 text-zinc-700" title={l.teamTools.length ? `Team uses: ${l.teamTools.join(", ")}` : ""}>
                          {l.team}{l.teamTools.length > 0 && <span className="ml-1 text-[10px] text-zinc-400">({l.teamTools.slice(0, 2).join(", ")})</span>}
                        </td>
                        <td className="px-2 py-1.5"><a href={l.source_url} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline">{l.name}</a></td>
                        <td className="px-2 py-1.5 text-zinc-600">{l.title}</td>
                        <td className="px-2 py-1.5"><Score s={l.confidence} label="Confidence they're still in this role" /></td>
                        <td className="px-2 py-1.5 text-zinc-500">
                          <a href={l.source_url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{host(l.source_url)} ↗</a>
                          <div className="text-[10px] text-zinc-400">{l.source_type.replace("_", " ")}{l.as_of ? ` · ${l.as_of}` : ""}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : map && !data?.running ? (
              <p className="text-sm text-zinc-500">No people found{regionFilter !== "All" ? ` in ${regionFilter}` : ""} yet. Press ▷ to search.</p>
            ) : null}
            <p className="mt-2 text-[10px] text-zinc-400">People come from public pages only; “In role” is 0–100 from source type and how recently the role was confirmed (hover a score). Verify before calling.</p>
          </>
        )}
      </div>
      <div className="border-t border-zinc-200 p-3 text-right">
        <a href={`/account/${encodeURIComponent(row.key)}`} className="text-xs text-indigo-700 hover:underline">Full evidence, change feed & agent trace →</a>
      </div>
    </aside>
  );
}

// ---------------- sheet ----------------
export default function Sheet() {
  const [user, setUser] = useUser();
  const [ws, setWs] = useState<Workspace | null | undefined>(undefined);
  const [onboarding, setOnboarding] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [savings, setSavings] = useState({ calls: 0, cost: 0, reuses: 0 });
  const [refreshDays, setRefreshDays] = useState(30);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [colEdit, setColEdit] = useState<{ id?: string; name: string; prompt: string } | null>(null);
  const [cellOpen, setCellOpen] = useState<Cell | null>(null);
  const [chat, setChat] = useState<{ who: "you" | "agent"; text: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [newInc, setNewInc] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(() =>
    fetch("/api/grid").then((r) => r.json()).then((d) => {
      setWs(d.workspace); setRows(d.rows); setColumns(d.columns); setCells(d.cells); setSavings(d.savings); setRefreshDays(d.refresh_days);
    }), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const o = new URLSearchParams(window.location.search).get("open");
    if (o) setOpenKey(o);
  }, []);
  const busy = rows.some((r) => r.research_status || r.orgmap_running) || cells.some((c) => c.status === "running");
  useEffect(() => {
    const t = setInterval(load, busy ? 2000 : 15000);
    return () => clearInterval(t);
  }, [busy, load]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);

  if (ws === undefined) return <main className="p-6 text-sm text-zinc-500">Loading…</main>;
  if (onboarding || ws === null) return <Onboarding user={user} onDone={() => { setOnboarding(false); load(); }} onCancel={ws ? () => setOnboarding(false) : undefined} />;

  const research = async (keys: string[], force = false) => {
    const d = await post("/api/grid/research", { keys, user, force });
    setChat((c) => [...c, { who: "agent", text: `Researching ${d.queued.length} row(s) live with You.com${d.reused.length ? `; ${d.reused.length} reused from recent team research (no API calls)` : ""}.` }]);
    load();
  };
  const send = async () => {
    const text = msg.trim();
    if (!text) return;
    setChat((c) => [...c, { who: "you", text }]); setMsg(""); setChatBusy(true);
    const d = await post("/api/chat", { message: text, user });
    setChatBusy(false);
    setChat((c) => [...c, { who: "agent", text: d.reply }]);
    load();
  };
  const saveColumn = async () => {
    if (!colEdit?.prompt.trim()) return;
    if (colEdit.id) await post(`/api/columns/${colEdit.id}`, { name: colEdit.name, prompt: colEdit.prompt, user }, "PATCH");
    else await post("/api/columns", { name: colEdit.name || colEdit.prompt.slice(0, 28), prompt: colEdit.prompt, user });
    setColEdit(null); load();
  };
  const setIncumbents = async (list: string[]) => { await post("/api/workspace", { id: ws.id, incumbents: list }); load(); };
  const cellFor = (key: string, col: string) => cells.find((c) => c.key === key && c.column_id === col);
  const allKeys = rows.map((r) => r.key);
  const openRow = rows.find((r) => r.key === openKey) ?? null;

  return (
    <main className="min-h-screen bg-white pb-40">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <Logo />
          <span className="text-zinc-300">/</span>
          <span className="truncate font-medium text-zinc-900">{ws.seller_name}</span>
          <span className="hidden truncate text-zinc-500 md:inline">· {ws.category_label}</span>
          <button onClick={() => setOnboarding(true)} className="text-xs text-indigo-700 underline">switch company</button>
        </div>
        <UserPicker user={user} setUser={setUser} />
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-4 py-2 text-xs">
        <span className="mr-1 uppercase tracking-wide text-zinc-500">Incumbent stack you displace</span>
        {ws.incumbents.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-zinc-800">
            {t}<button onClick={() => setIncumbents(ws.incumbents.filter((x) => x !== t))} className="text-zinc-400 hover:text-zinc-900">×</button>
          </span>
        ))}
        <input value={newInc} onChange={(e) => setNewInc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newInc.trim()) { setIncumbents([...ws.incumbents, newInc.trim()]); setNewInc(""); } }} placeholder="+ add tool" className="w-24 rounded border border-dashed border-zinc-300 px-1.5 py-0.5" />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2 text-sm">
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">⟳ You.com auto-refresh every {refreshDays} days</span>
        <span className="text-xs text-zinc-500">{rows.length} rows</span>
        <button onClick={() => research(sel.size ? [...sel] : allKeys)} disabled={!rows.length} className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40">▷ Run research {sel.size ? `(${sel.size} selected)` : "(all)"}</button>
        <button onClick={() => setColEdit({ name: "", prompt: "" })} className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">+ Add column</button>
        <span className="ml-auto text-xs text-zinc-500">Shared research saved <b>{savings.calls}</b> API calls (~${savings.cost.toFixed(2)})</span>
      </div>

      {colEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-3">
          <input value={colEdit.name} onChange={(e) => setColEdit({ ...colEdit, name: e.target.value })} placeholder="Column name (e.g. Cloud provider)" className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm" />
          <input value={colEdit.prompt} onChange={(e) => setColEdit({ ...colEdit, prompt: e.target.value })} placeholder="Prompt, e.g. Which cloud provider does {company} run on?" className="min-w-[320px] flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm" />
          <button onClick={saveColumn} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">{colEdit.id ? "Save & re-run" : "Add & run"}</button>
          <button onClick={() => setColEdit(null)} className="text-sm text-zinc-500 underline">cancel</button>
          <p className="w-full text-xs text-zinc-500">Each cell is answered live by the You.com Answer API with citations (~$0.005 per cell). Use {"{company}"} and {"{domain}"} in the prompt.</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-600">
              <th className="w-10 border-r border-zinc-200 px-2 py-2"><input type="checkbox" checked={sel.size > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(allKeys) : new Set())} /></th>
              <th className="w-8 border-r border-zinc-200 px-2">#</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Company</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Incumbent stack</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Relevance</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Evidence</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Why they fit</th>
              <th className="border-r border-zinc-200 px-3 font-medium">Refreshed</th>
              {columns.map((c) => (
                <th key={c.id} className="border-r border-zinc-200 px-3 font-medium" title={c.prompt}>
                  <div className="flex items-center gap-1">
                    <span>✦ {c.name}</span>
                    <button onClick={() => setColEdit({ id: c.id, name: c.name, prompt: c.prompt })} className="text-zinc-400 hover:text-zinc-900" title="Edit column">✎</button>
                    <button onClick={() => post(`/api/columns/${c.id}`, { user, keys: sel.size ? [...sel] : undefined }).then(load)} className="rounded border border-zinc-300 px-1 text-[10px] hover:bg-white" title="Run this column">▷</button>
                    <button onClick={() => fetch(`/api/columns/${c.id}`, { method: "DELETE" }).then(load)} className="text-zinc-400 hover:text-zinc-900" title="Delete column">×</button>
                  </div>
                </th>
              ))}
              <th className="px-2"><button onClick={() => setColEdit({ name: "", prompt: "" })} className="text-xs text-zinc-500 hover:text-zinc-900">+ column</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9 + columns.length} className="px-4 py-10 text-center text-zinc-500">No rows yet. Use the chat below: “add OpenAI, Stripe”.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.key} onClick={() => setOpenKey(r.key)} className={`cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 ${openKey === r.key ? "bg-indigo-50/50" : ""}`}>
                <td className="border-r border-zinc-100 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(r.key)} onChange={() => { const n = new Set(sel); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); setSel(n); }} />
                </td>
                <td className="border-r border-zinc-100 px-2 text-xs text-zinc-400">{i + 1}</td>
                <td className="border-r border-zinc-100 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={favicon(r.domain)} alt="" className="h-4 w-4 rounded" />
                    <span className="font-medium text-zinc-900">{r.company}</span>
                    <span className="text-xs text-zinc-400">{r.meta?.industry ?? r.domain}</span>
                  </div>
                </td>
                <td className="border-r border-zinc-100 px-3">
                  {r.research_status ? <span className="animate-pulse text-xs text-red-600">● {r.research_status === "running" ? "researching live…" : "queued"}</span>
                    : r.incumbents.length ? r.incumbents.map((t) => (
                      <a key={t.tool} href={t.url} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer" title={`${t.confidence}${t.stale ? " · stale" : ""}`} className={`mr-1 inline-flex items-center gap-1 rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-800 hover:underline ${t.stale ? "opacity-50" : ""}`}>
                        {t.tool}<span className={`h-1.5 w-1.5 rounded-full ${t.confidence === "Confirmed" ? "bg-emerald-500" : t.confidence === "Strong" ? "bg-indigo-500" : "bg-zinc-400"}`} />
                      </a>))
                    : r.researched ? <span className="text-xs text-zinc-400">No evidence found</span>
                    : <button onClick={(e) => { e.stopPropagation(); research([r.key]); }} className="text-xs text-indigo-700 underline">▷ run</button>}
                </td>
                <td className="border-r border-zinc-100 px-3">{r.researched && !r.research_status ? <VerdictBadge verdict={r.verdict} score={r.score} /> : null}</td>
                <td className="border-r border-zinc-100 px-3 text-xs text-zinc-700">{r.researched ? `${r.receipts} receipts · ${r.hiring} job posts` : ""}</td>
                <td className="max-w-[280px] truncate border-r border-zinc-100 px-3 text-xs text-zinc-600" title={r.meta?.why ?? ""}>{r.meta?.why ?? "—"}</td>
                <td className="border-r border-zinc-100 px-3 text-xs text-zinc-600">
                  {ago(r.last_checked_at || r.last_researched_at)}
                  {r.researched && <div className="text-[10px] text-zinc-400">next {new Date(r.next_refresh).toLocaleDateString()}</div>}
                </td>
                {columns.map((c) => {
                  const cell = cellFor(r.key, c.id);
                  return (
                    <td key={c.id} className="max-w-[240px] border-r border-zinc-100 px-3 text-xs" onClick={(e) => { e.stopPropagation(); if (cell && cell.status !== "running") setCellOpen(cell); }}>
                      {!cell ? <span className="text-zinc-300">—</span> : cell.status === "running" ? <span className="animate-pulse text-zinc-500">asking You.com…</span> : (
                        <span className="block truncate text-zinc-800 hover:underline" title={cell.value}>
                          {cell.value || "Unknown"} {cell.citations.length > 0 && <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] text-indigo-700">{cell.citations.length} src</span>}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* chat bar */}
      <div className={`fixed bottom-0 left-0 z-10 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur ${openRow ? "right-[min(760px,100vw)]" : "right-0"}`}>
        {chat.length > 0 && (
          <div className="mb-2 max-h-32 space-y-1 overflow-y-auto text-xs">
            {chat.slice(-8).map((m, i) => (
              <div key={i} className={m.who === "you" ? "text-zinc-900" : "text-indigo-800"}><b>{m.who === "you" ? "You" : "Tripwire"}:</b> {m.text}</div>
            ))}
            {chatBusy && <div className="animate-pulse text-indigo-800">Tripwire is asking You.com…</div>}
            <div ref={chatEnd} />
          </div>
        )}
        <div className="flex gap-2">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !chatBusy && send()} placeholder='Try: "discover Splunk" · "add OpenAI, Anthropic" · "find 5 fintechs like Stripe" · "add column Cloud: Which cloud does {company} run on?"' className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
          <button onClick={send} disabled={chatBusy} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Send</button>
        </div>
      </div>

      {openRow && <OrgPanel row={openRow} user={user} incumbents={ws.incumbents} onClose={() => setOpenKey(null)} />}

      {cellOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setCellOpen(null)}>
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
