// Prompt columns: a user (or agent) writes a prompt; every row gets a cited answer from the
// You.com Answer API. "{company}" and "{domain}" are substituted per row.
import crypto from "crypto";
import { addColumn, getAccount, listAccounts, setCell, type Column } from "./db";

export function createColumn(name: string, prompt: string, user: string): Column {
  const c = { id: crypto.randomUUID(), name, prompt, created_by: user, created_at: new Date().toISOString() };
  addColumn(c);
  return c;
}

async function answerCell(col: Column, key: string, user: string) {
  const a = getAccount(key);
  if (!a) return;
  const at = new Date().toISOString();
  setCell({ key, column_id: col.id, value: "", citations: [], at, by: user, status: "running" });
  const q = (col.prompt.includes("{company}") ? col.prompt : `${col.prompt} — for ${a.company} (${a.domain})`)
    .replaceAll("{company}", a.company).replaceAll("{domain}", a.domain) +
    ". Answer in one short line (under 15 words), then nothing else. If unknown, say Unknown.";
  try {
    const r = await fetch("https://api.you.com/v1/answer", {
      method: "POST",
      headers: { "X-API-Key": process.env.YDC_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`${r.status}`);
    const value = String(body.answer ?? "").replace(/\s*\[\[?[\d,\s]+\]?\]/g, "").split("\n")[0].trim();
    setCell({ key, column_id: col.id, value, citations: body.citations ?? [], at, by: user, status: "done" });
  } catch (e) {
    setCell({ key, column_id: col.id, value: `Error: ${(e as Error).message}`, citations: [], at, by: user, status: "error" });
  }
}

export function runColumn(col: Column, user: string, keys?: string[]) {
  const targets = keys?.length ? keys : listAccounts().map((a) => a.key);
  // small concurrency so a 50-row sheet doesn't burst
  let i = 0;
  const worker = async () => {
    while (i < targets.length) await answerCell(col, targets[i++], user);
  };
  void Promise.all([worker(), worker(), worker()]);
  return targets.length;
}
