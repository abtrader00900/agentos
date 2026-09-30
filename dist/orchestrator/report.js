const cell = (s) => s.split("\n")[0].replace(/\|/g, "\\|").slice(0, 120);
export function prBody(s) {
    const minutes = Math.round((Date.now() - Date.parse(s.createdAt)) / 60_000);
    const rows = s.subtasks.map((t) => `| ${t.id} | ${t.agent} | ${t.status} | ${cell(t.summary ?? "")} |`).join("\n");
    return [
        `**Task:** ${s.task}`,
        s.plan ? `**Plan:** ${s.plan.summary}` : "",
        `| Subtask | Agent | Status | Summary |\n|---|---|---|---|\n${rows}`,
        // verify output stays out of the PR: test logs can hold connection strings and keys that redact() does not know
        `**Verify:** ${s.verifyOk ? "passed" : "not run"} · **Fix rounds:** ${s.fixRound} · **Time:** ${minutes} min · full log: \`.agentos/runs/${s.id}/state.json\``,
        s.findings.length
            ? `**Review notes (non-blocking):**\n${s.findings.map((f) => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ""} ${f.issue}`).join("\n")}`
            : "**Review:** no findings",
        "🤖 Opened by [agentos](https://github.com/abtrader00900/agentos) — review before merging.",
    ]
        .filter(Boolean)
        .join("\n\n");
}
/** one line per run for `agentos runs`, with the reason under it when the run did not open a PR */
export function runLine(s) {
    const why = s.reason && s.status !== "pr_open" ? `\n    ${s.reason.split("\n")[0]}` : "";
    return `${s.id}  ${s.status.padEnd(11)}  ${s.task.slice(0, 60)}${s.prUrl ? `  ${s.prUrl}` : ""}${why}`;
}
/** "agentos: <task>" for the PR title, cut at a word boundary so it never ends mid-word */
export function prTitle(task, max = 72) {
    const t = `agentos: ${task.replace(/\s+/g, " ").trim()}`;
    if (t.length <= max)
        return t;
    const cut = t.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
//# sourceMappingURL=report.js.map