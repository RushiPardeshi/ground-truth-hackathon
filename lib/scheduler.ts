// Monthly refresh: every hour, any account whose last check is older than REFRESH_DAYS gets a
// You.com watch pass (fresh job posts / news + re-read of known postings), attributed to "auto-refresh".
import { listAccounts, latestSnapshot } from "./db";
import { startWatch } from "./pipeline";

export const REFRESH_DAYS = Number(process.env.TRIPWIRE_REFRESH_DAYS || 30);
const g = globalThis as unknown as { __twSched?: NodeJS.Timeout };

export function refreshDue(): string[] {
  const cutoff = Date.now() - REFRESH_DAYS * 86400_000;
  return listAccounts().filter((a) => {
    const t = new Date(a.last_checked_at || a.last_researched_at || 0).getTime();
    return t < cutoff && latestSnapshot(a.key);
  }).map((a) => a.key);
}

export function ensureScheduler() {
  if (g.__twSched) return;
  const tick = () => refreshDue().slice(0, 5).forEach((k) => startWatch(k, "auto-refresh"));
  g.__twSched = setInterval(tick, 3600_000);
  setTimeout(tick, 10_000);
}
