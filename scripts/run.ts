// Usage: npm run research -- "Company" [domain] [user]
// Runs the full pipeline once and prints evidence JSON. Also usable by any coding agent.
import { resolveDomain, runs, startResearch, startWatch, accountKey } from "../lib/pipeline";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const isWatch = cmd === "watch";
  const company = isWatch ? rest[0] : cmd;
  if (!company) {
    console.error('usage: npm run research -- "Company" [domain] [user]\n       npm run research -- watch <domain> [user]');
    process.exit(1);
  }
  const user = (isWatch ? rest[1] : rest[1]) || "cli";
  let state;
  if (isWatch) {
    state = startWatch(accountKey(company, "observability"), user);
  } else {
    const { domain } = await resolveDomain(company, rest[0]);
    state = startResearch({ company, domain, category: "observability", user });
  }
  let printed = 0;
  while (runs.get(state.id)!.status === "running") {
    await new Promise((r) => setTimeout(r, 500));
    const s = runs.get(state.id)!;
    for (; printed < s.trace.length; printed++) {
      const t = s.trace[printed];
      console.error(`[${(t.t / 1000).toFixed(1)}s] ${t.step.padEnd(9)} ${t.message}`);
    }
  }
  const s = runs.get(state.id)!;
  for (; printed < s.trace.length; printed++) console.error(`[${(s.trace[printed].t / 1000).toFixed(1)}s] ${s.trace[printed].step.padEnd(9)} ${s.trace[printed].message}`);
  const p = s.partial;
  console.log(JSON.stringify({ status: s.status, error: s.error, score: p.score, verdict: p.verdict, breakdown: p.breakdown, cost: s.cost, changes: s.changes, evidence: p.evidence, migrations: p.migrations, conflicts: p.conflicts?.map((c) => c.description), brief: p.brief?.content?.slice(0, 600) }, null, 2));
}
main();
