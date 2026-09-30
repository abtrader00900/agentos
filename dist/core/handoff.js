import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MemoryStore, oneLine } from "../mcp/memory/store.js";
import { lessonStatus } from "../learning/lessons.js";
/** pinned facts always; beyond that, this many of the most recent in HANDOFF.md */
const MAX_MD_FACTS = 30;
/** HANDOFF.md files we generate carry this in their footer */
const FOOTER_MARK = "AgentOS Handoff Protocol";
export function gitCapture(cwd, args) {
    try {
        return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    }
    catch {
        return "";
    }
}
export function collectGitState(cwd) {
    const branch = gitCapture(cwd, ["branch", "--show-current"]) || "(detached)";
    const head = gitCapture(cwd, ["rev-parse", "HEAD"]);
    const lastCommits = gitCapture(cwd, ["log", "-5", "--format=%h %s"]).split("\n").filter(Boolean);
    const status = gitCapture(cwd, ["status", "--short"]);
    const diffStat = gitCapture(cwd, ["diff", "--stat"]);
    return { branch, head, lastCommits, status, diffStat };
}
export function exportHandoff(cwd, input) {
    const memDb = path.join(cwd, ".agentos", "memory.json");
    let memory = [];
    if (existsSync(memDb)) {
        const store = new MemoryStore(memDb);
        // a pending lesson is unreviewed model output: it never travels to another agent
        memory = store.recall({ limit: Number.MAX_SAFE_INTEGER }).filter((f) => f.topic !== "lessons" || lessonStatus(f) !== "pending").map((f) => ({
            topic: f.topic, key: f.key, value: f.value, pinned: !!f.pinned, updatedAt: f.updated_at,
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
        // HANDOFF.md is appended to every harness rule file: pinned facts plus the most
        // recent ones; bundle.json keeps the whole snapshot
        const shown = bundle.memory.filter((m, i) => m.pinned || i < MAX_MD_FACTS);
        lines.push("## Memory Snapshot", "");
        for (const m of shown) {
            // the date lets a reader spot a fact reality has moved past ("PINs not rotated yet")
            const updated = m.updatedAt ? ` _(updated ${m.updatedAt.slice(0, 10)})_` : "";
            lines.push(`- **[${oneLine(m.topic)}/${oneLine(m.key)}]**${m.pinned ? " 📌" : ""} ${oneLine(m.value)}${updated}`);
        }
        if (shown.length < bundle.memory.length) {
            lines.push(`- _…${bundle.memory.length - shown.length} more facts in bundle.json (or ask the memory MCP server)_`);
        }
        lines.push("");
    }
    if (bundle.notes) {
        lines.push("## Notes", bundle.notes, "");
    }
    lines.push("---", `_${FOOTER_MARK} v${bundle.version}. Machine-readable: same directory, bundle.json_`);
    return lines.join("\n") + "\n";
}
/** FR-7.1/7.2: write bundle to .agentos/handoffs/<ts>/ (+ HANDOFF.md at project root) */
export function writeHandoff(cwd, bundle) {
    const ts = bundle.createdAt.replace(/[:.]/g, "-");
    const dir = path.join(cwd, ".agentos", "handoffs", ts);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
    writeFileSync(path.join(dir, "HANDOFF.md"), bundleToMarkdown(bundle));
    // a HANDOFF.md we did not write is someone's document: keep it before replacing it
    const rootMd = path.join(cwd, "HANDOFF.md");
    if (existsSync(rootMd) && !readFileSync(rootMd, "utf8").includes(FOOTER_MARK)) {
        let bak = rootMd + ".bak";
        for (let i = 1; existsSync(bak); i++)
            bak = `${rootMd}.bak.${i}`;
        copyFileSync(rootMd, bak);
    }
    writeFileSync(rootMd, bundleToMarkdown(bundle));
    return { dir, rootMd };
}
export function latestHandoffDir(cwd) {
    const root = path.join(cwd, ".agentos", "handoffs");
    if (!existsSync(root))
        return null;
    // only bundle directories (<ISO-timestamp>/bundle.json); their names sort chronologically
    const dirs = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{4}-\d\d-\d\dT/.test(e.name) && existsSync(path.join(root, e.name, "bundle.json")))
        .map((e) => e.name)
        .sort();
    return dirs.length ? path.join(root, dirs[dirs.length - 1]) : null;
}
export function importHandoff(bundlePath) {
    const raw = JSON.parse(readFileSync(bundlePath, "utf8"));
    if (raw?.format !== "agentos-handoff") {
        throw new Error(`Not an agentos handoff bundle: ${bundlePath}`);
    }
    if (raw.version !== 1) {
        throw new Error(`Unsupported handoff version ${raw.version} (this agentos supports v1)`);
    }
    // RFC §6: readers tolerate missing optional parts — a hand-written or older bundle must still render
    const list = (v) => (Array.isArray(v) ? v.map(String) : []);
    const git = (raw.git ?? {});
    return {
        format: "agentos-handoff",
        version: 1,
        createdAt: String(raw.createdAt ?? ""),
        fromHarness: String(raw.fromHarness ?? "unknown"),
        toHarness: String(raw.toHarness ?? "any"),
        task: String(raw.task ?? ""),
        filesInProgress: list(raw.filesInProgress),
        pendingDecisions: list(raw.pendingDecisions),
        openQuestions: list(raw.openQuestions),
        notes: String(raw.notes ?? ""),
        memory: Array.isArray(raw.memory) ? raw.memory.filter((m) => m && typeof m === "object") : [],
        git: { branch: String(git.branch ?? ""), head: String(git.head ?? ""), lastCommits: list(git.lastCommits), status: String(git.status ?? ""), diffStat: String(git.diffStat ?? "") },
    };
}
export const HANDOFF_FIX = 'Finished? Run: agentos handoff --clear, then agentos sync. Still in progress? Write a fresh one: agentos handoff --task "..."';
/**
 * Staleness of the handoff sync injects into every rule file (the root HANDOFF.md): days since
 * it was written and commits since its HEAD. Nobody refreshed the ERP's, and it kept telling
 * every new chat to do work finished days earlier. null when there is no HANDOFF.md.
 */
export function handoffStaleness(cwd, limits) {
    const rootMd = path.join(cwd, "HANDOFF.md");
    if (!existsSync(rootMd))
        return null;
    const md = readFileSync(rootMd, "utf8");
    const created = createdAt(md);
    let bundle = null;
    try {
        const dir = bundleDir(cwd, md);
        if (dir && existsSync(path.join(dir, "bundle.json")))
            bundle = importHandoff(path.join(dir, "bundle.json"));
    }
    catch { /* unreadable bundle: the date alone */ }
    const createdMs = Date.parse(bundle?.createdAt || created || "");
    const ageMs = Date.now() - (Number.isNaN(createdMs) ? statSync(rootMd).mtimeMs : createdMs);
    const days = Math.floor(ageMs / 864e5);
    // bundles before 0.2.2 have no git.head; their first "Recent commits" line starts with the short hash
    const commit = bundle?.git.head || bundle?.git.lastCommits[0]?.split(" ")[0] || "";
    const count = /^[0-9a-f]{4,64}$/i.test(commit) ? gitCapture(cwd, ["rev-list", "--count", `${commit}..HEAD`]) : "";
    const commits = count ? Number(count) : null;
    const detail = `HANDOFF.md is ${days} day${days === 1 ? "" : "s"} old` +
        (commits === null ? "" : `, ${commits} commit${commits === 1 ? "" : "s"} since it was written`);
    return { stale: ageMs > limits.handoffDays * 864e5 || (commits ?? 0) > limits.handoffCommits, detail };
}
const createdAt = (md) => /^- \*\*Created:\*\* (\S+)/m.exec(md)?.[1];
/** ours names its bundle: "- **Created:** <createdAt>" → .agentos/handoffs/<createdAt with ":." as "-"> */
function bundleDir(cwd, md) {
    const created = createdAt(md);
    return created ? path.join(cwd, ".agentos", "handoffs", created.replace(/[:.]/g, "-")) : null;
}
/** Stop injecting a finished handoff. Its bundle (and markdown copy) stay in .agentos/handoffs/. */
export function clearHandoff(cwd) {
    const rootMd = path.join(cwd, "HANDOFF.md");
    if (!existsSync(rootMd))
        return false;
    const md = readFileSync(rootMd, "utf8").replace(/\r\n/g, "\n");
    if (!md.includes(FOOTER_MARK)) {
        throw new Error("HANDOFF.md was not written by agentos — move or delete it yourself (sync injects it while it exists).");
    }
    // only delete what the bundle directory keeps a copy of: notes added to HANDOFF.md exist nowhere else
    const dir = bundleDir(cwd, md);
    const copy = dir && path.join(dir, "HANDOFF.md");
    if (!copy || !existsSync(copy) || readFileSync(copy, "utf8").replace(/\r\n/g, "\n") !== md) {
        throw new Error("HANDOFF.md was edited after agentos wrote it (or its bundle copy is missing) — move your notes elsewhere, then delete it yourself.");
    }
    rmSync(rootMd);
    return true;
}
//# sourceMappingURL=handoff.js.map