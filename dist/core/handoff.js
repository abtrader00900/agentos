import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MemoryStore } from "../mcp/memory/store.js";
function gitCapture(cwd, args) {
    try {
        return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    }
    catch {
        return "";
    }
}
export function collectGitState(cwd) {
    const branch = gitCapture(cwd, ["branch", "--show-current"]) || "(detached)";
    const lastCommits = gitCapture(cwd, ["log", "-5", "--format=%h %s"]).split("\n").filter(Boolean);
    const status = gitCapture(cwd, ["status", "--short"]);
    const diffStat = gitCapture(cwd, ["diff", "--stat"]);
    return { branch, lastCommits, status, diffStat };
}
export function exportHandoff(cwd, input) {
    const memDb = path.join(cwd, ".agentos", "memory.json");
    let memory = [];
    if (existsSync(memDb)) {
        const store = new MemoryStore(memDb);
        memory = store.recall({ limit: Number.MAX_SAFE_INTEGER }).map((f) => ({
            topic: f.topic, key: f.key, value: f.value, pinned: !!f.pinned,
        }));
    }
    return {
        format: "agentos-handoff",
        version: 1,
        createdAt: new Date().toISOString(),
        fromHarness: input.fromHarness ?? "unknown",
        toHarness: input.toHarness ?? "unknown",
        task: input.task,
        filesInProgress: input.filesInProgress,
        pendingDecisions: input.pendingDecisions,
        openQuestions: input.openQuestions,
        notes: input.notes ?? "",
        memory,
        git: collectGitState(cwd),
    };
}
export function bundleToMarkdown(bundle) {
    const lines = [
        "# Agent Handoff",
        "",
        `- **From:** ${bundle.fromHarness} → **To:** ${bundle.toHarness}`,
        `- **Created:** ${bundle.createdAt}`,
        "",
        "## Active Task",
        bundle.task,
        "",
    ];
    if (bundle.filesInProgress.length) {
        lines.push("## Files In Progress", ...bundle.filesInProgress.map((f) => `- ${f}`), "");
    }
    if (bundle.pendingDecisions.length) {
        lines.push("## Pending Decisions", ...bundle.pendingDecisions.map((d) => `- ${d}`), "");
    }
    if (bundle.openQuestions.length) {
        lines.push("## Open Questions", ...bundle.openQuestions.map((q) => `- ${q}`), "");
    }
    lines.push("## Git State", `- Branch: \`${bundle.git.branch}\``, "", "Recent commits:", ...bundle.git.lastCommits.map((c) => `- ${c}`), "");
    if (bundle.git.status) {
        lines.push("Working tree:", "```", bundle.git.status, "```", "");
    }
    if (bundle.memory.length) {
        lines.push("## Memory Snapshot", "");
        for (const m of bundle.memory) {
            lines.push(`- **[${m.topic}/${m.key}]**${m.pinned ? " 📌" : ""} ${m.value}`);
        }
        lines.push("");
    }
    if (bundle.notes) {
        lines.push("## Notes", bundle.notes, "");
    }
    lines.push("---", `_AgentOS Handoff Protocol v${bundle.version}. Machine-readable: same directory, bundle.json_`);
    return lines.join("\n") + "\n";
}
/** FR-7.1/7.2: write bundle to .agentos/handoffs/<ts>/ (+ HANDOFF.md at project root) */
export function writeHandoff(cwd, bundle) {
    const ts = bundle.createdAt.replace(/[:.]/g, "-");
    const dir = path.join(cwd, ".agentos", "handoffs", ts);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
    writeFileSync(path.join(dir, "HANDOFF.md"), bundleToMarkdown(bundle));
    const rootMd = path.join(cwd, "HANDOFF.md");
    writeFileSync(rootMd, bundleToMarkdown(bundle));
    return { dir, rootMd };
}
export function latestHandoffDir(cwd) {
    const root = path.join(cwd, ".agentos", "handoffs");
    if (!existsSync(root))
        return null;
    const dirs = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    return dirs.length ? path.join(root, dirs[dirs.length - 1]) : null;
}
export function importHandoff(bundlePath) {
    const raw = JSON.parse(readFileSync(bundlePath, "utf8"));
    if (raw.format !== "agentos-handoff") {
        throw new Error(`Not an agentos handoff bundle: ${bundlePath}`);
    }
    if (raw.version !== 1) {
        throw new Error(`Unsupported handoff version ${raw.version} (this agentos supports v1)`);
    }
    return raw;
}
//# sourceMappingURL=handoff.js.map