import type { AgentReport } from "./gates.js";
import type { RunState } from "./run.js";

const cell = (s: string) => s.split("\n")[0].replace(/\|/g, "\\|").slice(0, 120);

const PARTS: Array<[keyof AgentReport, string]> = [["notDone", "Not done"], ["assumed", "Assumed"], ["notVerified", "Not verified"]];

/** what the agents themselves say they left out, assumed or could not check */
function agentReports(s: RunState): string {
  const who = [
    ...s.subtasks.map((t) => ({ name: `${t.id} (${t.agent})`, r: t.report })),
    ...(s.fixRound > 0 ? [{ name: "last fix round", r: s.fixReport }] : []),
  ];
  const lines = who.flatMap(({ name, r }) => {
    if (!r) return [`- ${name}: no report`];
    const parts = PARTS.filter(([k]) => r[k].length).map(([k, label]) => `  - ${label}: ${r[k].map(cell).join("; ")}`);
    return parts.length ? [`- ${name}:`, ...parts] : [];
  });
  return lines.length ? `**What the agents report:**\n${lines.join("\n")}` : "";
}

export function prBody(s: RunState): string {
  const minutes = Math.round((Date.now() - Date.parse(s.createdAt)) / 60_000);
  const rows = s.subtasks.map((t) => `| ${t.id} | ${t.agent} | ${t.status} | ${cell(t.summary ?? "")} |`).join("\n");
  return [
    `**Task:** ${s.task}`,
    s.risk?.length
      ? `**⚠️ Look here** — risky parts of this change:\n${s.risk.map((f) => `- ${f.rule}: ${f.files.slice(0, 5).join(", ")}${f.files.length > 5 ? ` (+${f.files.length - 5} more)` : ""}`).join("\n")}`
      : "",
    s.plan ? `**Plan:** ${s.plan.summary}` : "",
    `| Subtask | Agent | Status | Summary |\n|---|---|---|---|\n${rows}`,
    agentReports(s),
    // verify output stays out of the PR: test logs can hold connection strings and keys that redact() does not know
    `**Verify:** ${s.verifyOk ? "passed" : "not run"} · **Fix rounds:** ${s.fixRound} · **Time:** ${minutes} min · full log: \`.agentos/runs/${s.id}/state.json\``,
    s.lessonsUsed?.length ? `**Lessons used:** ${s.lessonsUsed.join(", ")}` : "",
    s.findings.length
      ? `**Review notes (non-blocking):**\n${s.findings.map((f) => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ""} ${f.issue}`).join("\n")}`
      : "**Review:** no findings",
    "🤖 Opened by [agentos](https://github.com/abtrader00900/agentos) — review before merging.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** one line per run for `agentos runs`, with the reason under it when the run did not open a PR */
export function runLine(s: RunState): string {
  const why = s.reason && s.status !== "pr_open" ? `\n    ${s.reason.split("\n")[0]}` : "";
  return `${s.id}  ${s.status.padEnd(11)}  ${s.task.slice(0, 60)}${s.prUrl ? `  ${s.prUrl}` : ""}${why}`;
}

/** "agentos: <task>" for the PR title, cut at a word boundary so it never ends mid-word */
export function prTitle(task: string, max = 72): string {
  const t = `agentos: ${task.replace(/\s+/g, " ").trim()}`;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
