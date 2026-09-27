#!/usr/bin/env node
// Markdown tables from run.mjs results:  node bench/report.mjs bench/results/agentos-full.json
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) throw new Error("usage: node bench/report.mjs <results.json>...");
const runs = files.flatMap((f) => JSON.parse(readFileSync(f, "utf8")).runs);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const int = (n) => Math.round(n).toLocaleString("en-US");
const usd = (n) => `$${n.toFixed(3)}`;
const pct = (a, b) => (b ? `${a >= b ? "+" : "−"}${Math.abs(((a - b) / b) * 100).toFixed(0)}%` : "n/a");
const spread = (xs, f) => (xs.length > 1 ? `${f(median(xs))} (${f(Math.min(...xs))}–${f(Math.max(...xs))})` : f(xs[0]));

const tasks = [...new Set(runs.map((r) => r.task))];
const stats = (task, arm) => {
  const rs = runs.filter((r) => r.task === task && r.arm === arm);
  const ok = rs.filter((r) => r.costUsd != null);
  const tools = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.tools ?? {})) tools[k.replace(/^mcp__\w+?__/, "")] = (tools[k.replace(/^mcp__\w+?__/, "")] ?? 0) + v;
  return {
    n: rs.length,
    pass: rs.filter((r) => r.pass).length,
    errors: rs.filter((r) => r.error).map((r) => r.error),
    tokens: ok.map((r) => r.tokens.total),
    output: ok.map((r) => r.tokens.output),
    cost: ok.map((r) => r.costUsd),
    turns: ok.map((r) => r.turns),
    tools: Object.entries(tools).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "),
  };
};

const out = [];
out.push("| task | pass (agentos / baseline) | total tokens, median | Δ tokens | cost, median | Δ cost | turns, median |", "|---|---|---|---|---|---|---|");
const totals = { a: 0, b: 0, ta: 0, tb: 0 };
for (const t of tasks) {
  const a = stats(t, "agentos"), b = stats(t, "baseline");
  if (!a.cost.length || !b.cost.length) continue;
  totals.a += median(a.cost); totals.b += median(b.cost); totals.ta += median(a.tokens); totals.tb += median(b.tokens);
  out.push(`| ${t} | ${a.pass}/${a.n} / ${b.pass}/${b.n} | ${int(median(a.tokens))} vs ${int(median(b.tokens))} | ${pct(median(a.tokens), median(b.tokens))} | ` +
    `${usd(median(a.cost))} vs ${usd(median(b.cost))} | ${pct(median(a.cost), median(b.cost))} | ${median(a.turns)} vs ${median(b.turns)} |`);
}
out.push(`| **all tasks** | | ${int(totals.ta)} vs ${int(totals.tb)} | ${pct(totals.ta, totals.tb)} | ${usd(totals.a)} vs ${usd(totals.b)} | ${pct(totals.a, totals.b)} | |`, "");
out.push("Cells read *agentos vs baseline*; Δ = agentos relative to baseline (− means agentos used less).", "");

for (const t of tasks) {
  out.push(`### ${t}`, "", "| arm | pass | total tokens | output tokens | cost | turns | tool calls (all reps) |", "|---|---|---|---|---|---|---|");
  for (const arm of ["agentos", "baseline"]) {
    const s = stats(t, arm);
    if (!s.n) continue;
    if (!s.cost.length) { out.push(`| ${arm} | ${s.pass}/${s.n} | — | — | — | — | ${s.errors.join("; ")} |`); continue; }
    out.push(`| ${arm} | ${s.pass}/${s.n} | ${spread(s.tokens, int)} | ${spread(s.output, int)} | ${spread(s.cost, usd)} | ${spread(s.turns, String)} | ${s.tools || "none"} |`);
  }
  const a = stats(t, "agentos"), b = stats(t, "baseline");
  if (a.cost.length && b.cost.length) out.push("", `Δ agentos vs baseline (medians): tokens ${pct(median(a.tokens), median(b.tokens))}, cost ${pct(median(a.cost), median(b.cost))}.`);
  const errs = [...a.errors, ...b.errors];
  if (errs.length) out.push("", `Run errors: ${errs.join("; ")}`);
  out.push("");
}
out.push(`Total cost of these ${runs.length} runs: ${usd(runs.reduce((s, r) => s + (r.costUsd ?? 0), 0))} (API list price).`);
console.log(out.join("\n"));
