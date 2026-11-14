import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { Account, ChangeItem, Snapshot } from "./types";

const DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DIR, { recursive: true });

const g = globalThis as unknown as { __twdb?: Database.Database };
export const db: Database.Database = g.__twdb ?? new Database(path.join(DIR, "tripwire.db"));
g.__twdb = db;
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  key TEXT PRIMARY KEY, company TEXT, domain TEXT, category TEXT,
  owner TEXT, claimed_at TEXT, last_researched_at TEXT, last_researched_by TEXT,
  last_checked_at TEXT, score INTEGER, verdict TEXT, handoff_requested_by TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, created_at TEXT, data TEXT
);
CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY, key TEXT, at TEXT, by TEXT, kind TEXT, message TEXT, url TEXT, evidence TEXT
);
CREATE TABLE IF NOT EXISTS savings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, at TEXT, by TEXT, calls INTEGER, cost REAL
);
CREATE TABLE IF NOT EXISTS aliases ( alias TEXT PRIMARY KEY, domain TEXT );
`);

export function getAccount(key: string): Account | null {
  return (db.prepare("SELECT * FROM accounts WHERE key = ?").get(key) as Account) ?? null;
}

export function listAccounts(): Account[] {
  return db.prepare("SELECT * FROM accounts ORDER BY COALESCE(last_researched_at, claimed_at) DESC").all() as Account[];
}

export function upsertAccount(a: Partial<Account> & { key: string }) {
  const cur = getAccount(a.key);
  const next = { ...(cur ?? {
    key: a.key, company: "", domain: "", category: "", owner: null, claimed_at: null,
    last_researched_at: null, last_researched_by: null, last_checked_at: null, score: null, verdict: null,
    handoff_requested_by: null,
  }), ...a } as Account;
  db.prepare(`INSERT OR REPLACE INTO accounts
    (key, company, domain, category, owner, claimed_at, last_researched_at, last_researched_by, last_checked_at, score, verdict, handoff_requested_by)
    VALUES (@key, @company, @domain, @category, @owner, @claimed_at, @last_researched_at, @last_researched_by, @last_checked_at, @score, @verdict, @handoff_requested_by)`).run(next);
  return next;
}

export function saveSnapshot(s: Snapshot) {
  db.prepare("INSERT INTO snapshots (key, created_at, data) VALUES (?, ?, ?)").run(s.key, s.created_at, JSON.stringify(s));
}

export function latestSnapshot(key: string): Snapshot | null {
  const row = db.prepare("SELECT data FROM snapshots WHERE key = ? ORDER BY id DESC LIMIT 1").get(key) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Snapshot) : null;
}

export function addChanges(items: ChangeItem[]) {
  const st = db.prepare("INSERT OR REPLACE INTO changes (id, key, at, by, kind, message, url, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const c of items) st.run(c.id, c.key, c.at, c.by, c.kind, c.message, c.url ?? null, c.evidence ? JSON.stringify(c.evidence) : null);
}

export function listChanges(key: string): ChangeItem[] {
  const rows = db.prepare("SELECT * FROM changes WHERE key = ? ORDER BY at DESC LIMIT 100").all(key) as (Omit<ChangeItem, "evidence"> & { evidence: string | null })[];
  return rows.map((r) => ({ ...r, evidence: r.evidence ? JSON.parse(r.evidence) : undefined }));
}

export function recordSaving(key: string, by: string, calls: number, cost: number) {
  db.prepare("INSERT INTO savings (key, at, by, calls, cost) VALUES (?, ?, ?, ?, ?)").run(key, new Date().toISOString(), by, calls, cost);
}

export function totalSavings(): { calls: number; cost: number; reuses: number } {
  const r = db.prepare("SELECT COALESCE(SUM(calls),0) calls, COALESCE(SUM(cost),0) cost, COUNT(*) reuses FROM savings").get() as { calls: number; cost: number; reuses: number };
  return r;
}

export function getAlias(alias: string): string | null {
  const r = db.prepare("SELECT domain FROM aliases WHERE alias = ?").get(alias) as { domain: string } | undefined;
  return r?.domain ?? null;
}

export function setAlias(alias: string, domain: string) {
  db.prepare("INSERT OR REPLACE INTO aliases (alias, domain) VALUES (?, ?)").run(alias, domain);
}

// ---------- grid: org maps, prompt columns, cells ----------
db.exec(`
CREATE TABLE IF NOT EXISTS orgmaps ( key TEXT PRIMARY KEY, at TEXT, by TEXT, data TEXT );
CREATE TABLE IF NOT EXISTS columns ( id TEXT PRIMARY KEY, name TEXT, prompt TEXT, created_by TEXT, created_at TEXT );
CREATE TABLE IF NOT EXISTS cells ( key TEXT, column_id TEXT, value TEXT, citations TEXT, at TEXT, by TEXT, status TEXT, PRIMARY KEY (key, column_id) );
`);

export function saveOrgMap(key: string, by: string, data: unknown) {
  db.prepare("INSERT OR REPLACE INTO orgmaps (key, at, by, data) VALUES (?, ?, ?, ?)").run(key, new Date().toISOString(), by, JSON.stringify(data));
}
export function getOrgMap(key: string): { at: string; by: string; data: unknown } | null {
  const r = db.prepare("SELECT * FROM orgmaps WHERE key = ?").get(key) as { at: string; by: string; data: string } | undefined;
  return r ? { at: r.at, by: r.by, data: JSON.parse(r.data) } : null;
}
export interface Column { id: string; name: string; prompt: string; created_by: string; created_at: string }
export interface Cell { key: string; column_id: string; value: string; citations: { source: string; excerpts: string[] }[]; at: string; by: string; status: string }
export function listColumns(): Column[] {
  return db.prepare("SELECT * FROM columns ORDER BY created_at").all() as Column[];
}
export function addColumn(c: Column) {
  db.prepare("INSERT INTO columns (id, name, prompt, created_by, created_at) VALUES (@id, @name, @prompt, @created_by, @created_at)").run(c);
}
export function deleteColumn(id: string) {
  db.prepare("DELETE FROM columns WHERE id = ?").run(id);
  db.prepare("DELETE FROM cells WHERE column_id = ?").run(id);
}
export function setCell(c: Omit<Cell, "citations"> & { citations: Cell["citations"] }) {
  db.prepare("INSERT OR REPLACE INTO cells (key, column_id, value, citations, at, by, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(c.key, c.column_id, c.value, JSON.stringify(c.citations), c.at, c.by, c.status);
}
export function listCells(): Cell[] {
  return (db.prepare("SELECT * FROM cells").all() as (Omit<Cell, "citations"> & { citations: string })[]).map((r) => ({ ...r, citations: JSON.parse(r.citations || "[]") }));
}
