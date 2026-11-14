// Recurring updates. Each workspace has its own settings (shared by the team): how often rows are
// re-checked, what gets refreshed (evidence, people per region, AI columns, new-company discovery),
// which rows, and a spend cap per cycle. A server tick every 15 minutes runs whatever is due.
import { listAccounts, latestSnapshot, getOrgMap, listColumns, getAccount, upsertAccount } from "./db";
import { db } from "./db";
import { runColumn } from "./columns";
import { startOrgMap, orgMapStatus } from "./orgmap";
import { accountKey, discoverAccounts, enqueueResearch, resolveDomain, runs, startWatch } from "./pipeline";
import { PRICE } from "./config";
import { getWorkspace } from "./workspace";

export interface RefreshSettings {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly" | "custom";
  every_days: number; // used when frequency = custom
  refresh_evidence: boolean; // watch pass: fresh job posts + news, re-read known postings
  refresh_people: boolean; // re-run each mapped region to add/update people
  refresh_columns: boolean; // re-ask every AI column
  discover_new: boolean; // find new companies hiring for your incumbent tools
  discover_per_cycle: number;
  scope: "all" | "warm_hot" | "selected";
  selected_keys: string[];
  max_spend_usd: number; // You.com spend cap per cycle
  updated_at: string | null;
  updated_by: string | null;
}

export interface RefreshLog {
  at: string; by: string; rows_checked: number; people_runs: number; column_cells: number; new_rows: number;
  spent_usd: number; stopped: string | null; details: string[];
}

export const DEFAULT_SETTINGS: RefreshSettings = {
  enabled: true, frequency: "monthly", every_days: 30,
  refresh_evidence: true, refresh_people: false, refresh_columns: false, discover_new: false, discover_per_cycle: 5,
  scope: "all", selected_keys: [], max_spend_usd: 2, updated_at: null, updated_by: null,
};

// Kept for older imports: the default interval.
export const REFRESH_DAYS = 30;

db.exec("CREATE TABLE IF NOT EXISTS settings ( k TEXT PRIMARY KEY, v TEXT )");
const getKV = (k: string) => (db.prepare("SELECT v FROM settings WHERE k = ?").get(k) as { v: string } | undefined)?.v;
const setKV = (k: string, v: string) => db.prepare("INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)").run(k, v);

export function intervalDays(s: RefreshSettings): number {
  return s.frequency === "daily" ? 1 : s.frequency === "weekly" ? 7 : s.frequency === "monthly" ? 30 : Math.max(1, Number(s.every_days) || 30);
}

export function getRefreshSettings(wsId: string): RefreshSettings {
  const raw = getKV(`refresh:${wsId}`);
  return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
}

export function saveRefreshSettings(wsId: string, patch: Partial<RefreshSettings>, by: string): RefreshSettings {
  const next = { ...getRefreshSettings(wsId), ...patch, updated_at: new Date().toISOString(), updated_by: by };
  next.max_spend_usd = Math.max(0.05, Math.min(50, Number(next.max_spend_usd) || DEFAULT_SETTINGS.max_spend_usd));
  next.discover_per_cycle = Math.max(1, Math.min(20, Number(next.discover_per_cycle) || 5));
  setKV(`refresh:${wsId}`, JSON.stringify(next));
  return next;
}

export function getRefreshLog(wsId: string): RefreshLog[] {
  const raw = getKV(`refresh_log:${wsId}`);
  return raw ? JSON.parse(raw) : [];
}

function pushLog(wsId: string, entry: RefreshLog) {
  setKV(`refresh_log:${wsId}`, JSON.stringify([entry, ...getRefreshLog(wsId)].slice(0, 20)));
}

function lastChecked(key: string): number {
  const a = getAccount(key);
  return new Date(a?.last_checked_at || a?.last_researched_at || 0).getTime();
}

export function nextDue(wsId: string, key: string): string {
  return new Date(lastChecked(key) + intervalDays(getRefreshSettings(wsId)) * 86400_000).toISOString();
}

function rowsInScope(wsId: string, s: RefreshSettings): string[] {
  const rows = listAccounts().filter((a) => a.category === wsId && latestSnapshot(a.key));
  if (s.scope === "selected") return rows.filter((a) => s.selected_keys.includes(a.key)).map((a) => a.key);
  if (s.scope === "warm_hot") return rows.filter((a) => a.verdict === "Hot" || a.verdict === "Warm").map((a) => a.key);
  return rows.map((a) => a.key);
}

export function dueRows(wsId: string, s = getRefreshSettings(wsId)): string[] {
  const cutoff = Date.now() - intervalDays(s) * 86400_000;
  return rowsInScope(wsId, s).filter((k) => lastChecked(k) < cutoff);
}

const g = globalThis as unknown as { __twSchedV2?: NodeJS.Timeout; __twCycles?: Set<string> };
const cycles: Set<string> = g.__twCycles ?? new Set();
g.__twCycles = cycles;

export function cycleRunning(wsId: string) {
  return cycles.has(wsId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitRun(id: string, timeoutMs = 180_000) {
  const t0 = Date.now();
  while (runs.get(id)?.status === "running" && Date.now() - t0 < timeoutMs) await sleep(1000);
  return runs.get(id);
}

async function waitOrg(key: string, timeoutMs = 150_000) {
  const t0 = Date.now();
  while (orgMapStatus(key).running && Date.now() - t0 < timeoutMs) await sleep(1500);
}

// One refresh cycle. force = refresh every row in scope now, not just the due ones ("Run now").
export async function runCycle(wsId: string, by: string, force = false): Promise<RefreshLog | null> {
  if (cycles.has(wsId)) return null;
  cycles.add(wsId);
  const s = getRefreshSettings(wsId);
  const log: RefreshLog = { at: new Date().toISOString(), by, rows_checked: 0, people_runs: 0, column_cells: 0, new_rows: 0, spent_usd: 0, stopped: null, details: [] };
  const budgetLeft = () => s.max_spend_usd - log.spent_usd;
  try {
    const keys = force ? rowsInScope(wsId, s) : dueRows(wsId, s);
    log.details.push(`${keys.length} row(s) ${force ? "in scope" : "due"} (${s.scope.replace("_", " ")}, every ${intervalDays(s)} day(s))`);

    for (const key of keys) {
      if (s.refresh_evidence) {
        if (budgetLeft() < 0.02) { log.stopped = "spend cap reached"; break; }
        const st = startWatch(key, by);
        const done = await waitRun(st.id);
        log.spent_usd += done?.cost ?? 0;
        log.rows_checked++;
        const changes = (done?.changes ?? []).filter((c) => c.kind !== "no_change").length;
        log.details.push(`${key.split("|")[0]}: ${changes} change(s)`);
      } else {
        // still stamp the row as checked so it isn't due again next tick
        upsertAccount({ key, last_checked_at: new Date().toISOString() });
      }

      if (s.refresh_people && getOrgMap(key)) {
        const map = getOrgMap(key)!.data as { regions?: string[]; teams?: { region: string }[] };
        const regions = [...new Set([...(map.regions ?? []), ...(map.teams ?? []).map((t) => t.region)])];
        for (const region of regions.length ? regions : [undefined]) {
          if (budgetLeft() < PRICE.research) { log.stopped = "spend cap reached"; break; }
          startOrgMap(key, by, region);
          await waitOrg(key);
          log.spent_usd += PRICE.research;
          log.people_runs++;
        }
        log.details.push(`${key.split("|")[0]}: people re-checked in ${regions.length || 1} region(s)`);
      }
      if (log.stopped) break;
    }

    if (s.refresh_columns && !log.stopped) {
      const cols = listColumns();
      const cost = cols.length * keys.length * PRICE.answer;
      if (cols.length && keys.length && cost <= budgetLeft()) {
        for (const c of cols) log.column_cells += runColumn(c, by, keys);
        log.spent_usd += cost;
        log.details.push(`${cols.length} AI column(s) re-asked for ${keys.length} row(s)`);
      } else if (cols.length && keys.length) log.details.push("AI columns skipped: would exceed spend cap");
    }

    if (s.discover_new && !log.stopped) {
      const ws = getWorkspace(wsId);
      for (const tool of (ws?.incumbents ?? []).slice(0, 3)) {
        if (log.new_rows >= s.discover_per_cycle || budgetLeft() < 0.015 + PRICE.search * 3) break;
        const found = await discoverAccounts({ tool, limit: 10 });
        log.spent_usd += PRICE.search * 3;
        for (const a of found.filter((x) => x.verified_count > 0)) {
          if (log.new_rows >= s.discover_per_cycle || budgetLeft() < 0.12) break;
          try {
            const { domain } = await resolveDomain(a.company, undefined);
            log.spent_usd += PRICE.search;
            const key = accountKey(domain, wsId);
            if (getAccount(key)) continue;
            const job = a.sample_jobs.find((j) => j.verified);
            upsertAccount({ key, company: a.company, domain, category: wsId, owner: by, claimed_at: new Date().toISOString(), meta: JSON.stringify({ industry: `${a.ats} · ${a.job_count} posts`, hq: job?.location ?? null, size: null, why: `Hiring: “${job?.title}” names ${tool}: “${job?.quote?.slice(0, 120)}”` }) });
            enqueueResearch([key], by);
            log.spent_usd += 0.11; // estimated full research
            log.new_rows++;
          } catch {}
        }
      }
      log.details.push(`${log.new_rows} new compan${log.new_rows === 1 ? "y" : "ies"} found via job boards`);
    }
  } catch (e) {
    log.stopped = `error: ${(e as Error).message}`;
  } finally {
    log.spent_usd = Math.round(log.spent_usd * 1000) / 1000;
    pushLog(wsId, log);
    cycles.delete(wsId);
  }
  return log;
}

export function ensureScheduler() {
  if (g.__twSchedV2) return;
  const tick = () => {
    const wsIds = [...new Set(listAccounts().map((a) => a.category))];
    for (const id of wsIds) {
      const s = getRefreshSettings(id);
      if (s.enabled && dueRows(id, s).length) void runCycle(id, "auto-refresh");
    }
  };
  g.__twSchedV2 = setInterval(tick, 15 * 60_000);
  setTimeout(tick, 15_000);
}
