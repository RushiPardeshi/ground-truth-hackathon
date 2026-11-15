// One-off repair for snapshots saved before the site-code detector fix:
// - drop site_code evidence that matched text inside another script (no src/href in the quote)
// - recategorize real loaded scripts that aren't in the workspace's incumbent watchlist as "other"
// - recompute stack, signals and score; save as a new snapshot (history kept).
import { db, latestSnapshot, saveSnapshot, upsertAccount } from "../lib/db";
import { reconcile, score } from "../lib/reconcile";
import { getProfile } from "../lib/workspace";

const keys = (db.prepare("SELECT DISTINCT key FROM snapshots").all() as { key: string }[]).map((r) => r.key);
for (const key of keys) {
  const snap = latestSnapshot(key);
  if (!snap) continue;
  const cat = getProfile(snap.category);
  const watch = new Set(snap.watchlist.map((w) => w.toLowerCase()));
  let dropped = 0;
  let moved = 0;
  const evidence = snap.evidence
    .filter((e) => {
      if (e.source_type !== "site_code") return true;
      const loaded = /\s(src|href)\s*=/.test(e.evidence_quote);
      if (!loaded) dropped++;
      return loaded;
    })
    .map((e) => {
      if (e.source_type === "site_code" && e.category !== "other" && !watch.has(e.tool.toLowerCase())) {
        moved++;
        return { ...e, category: "other" };
      }
      return e;
    });
  if (!dropped && !moved) continue;
  const r = reconcile(evidence, cat);
  const s = score(evidence, r);
  saveSnapshot({ ...snap, evidence, ...r, ...s, created_at: new Date().toISOString() });
  upsertAccount({ key, score: s.score, verdict: s.verdict });
  console.log(`${key}: dropped ${dropped} inline-text match(es), moved ${moved} non-incumbent script(s) → ${s.score} ${s.verdict}`);
}
