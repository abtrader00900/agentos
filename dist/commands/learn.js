import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
/** Commits touching more files than this are bulk moves/vendor drops: noise for co-change, and O(n²) pairs. */
const MAX_FILES_PER_COMMIT = 50;
const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: "agentos", GIT_AUTHOR_EMAIL: "agentos@local",
    GIT_COMMITTER_NAME: "agentos", GIT_COMMITTER_EMAIL: "agentos@local",
};
/** Parse `git log --name-only` into per-commit file lists */
export function commitFileSets(cwd, maxCommits = 500) {
    let out;
    try {
        out = execFileSync("git", ["log", `--max-count=${maxCommits}`, "--pretty=tformat:##COMMIT##", "--name-only"], {
            cwd, encoding: "utf8", env: GIT_ENV, maxBuffer: 64 * 1024 * 1024,
        });
    }
    catch {
        return [];
    }
    const sets = [];
    let current = [];
    for (const line of out.split("\n")) {
        if (line === "##COMMIT##") {
            if (current.length)
                sets.push(current);
            current = [];
        }
        else if (line.trim()) {
            current.push(line.trim());
        }
    }
    if (current.length)
        sets.push(current);
    return sets;
}
export function learnFromHistory(cwd) {
    const sets = commitFileSets(cwd);
    const rules = [];
    // 1. co-change pairs: files that change together repeatedly
    const pairCounts = new Map();
    const fileCounts = new Map();
    for (const files of sets) {
        const uniq = [...new Set(files)].sort();
        if (uniq.length > MAX_FILES_PER_COMMIT)
            continue;
        for (const f of uniq)
            fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
        for (let i = 0; i < uniq.length; i++) {
            for (let j = i + 1; j < uniq.length; j++) {
                const key = `${uniq[i]} <> ${uniq[j]}`;
                pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
            }
        }
    }
    for (const [pair, count] of [...pairCounts.entries()].sort((a, b) => b[1] - a[1])) {
        if (count < 3)
            continue;
        const [a, b] = pair.split(" <> ");
        rules.push({
            id: `learned-cochange-${slug(a)}-${slug(b)}`,
            text: `"${a}" and "${b}" changed together in ${count} commits — when editing one, check the other.`,
            evidence: `${count} co-changing commits`,
        });
        if (rules.length >= 5)
            break;
    }
    // 2. hot files: change very often → always run their tests
    for (const [file, count] of [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
        if (count < 5)
            continue;
        rules.push({
            id: `learned-hot-${slug(file)}`,
            text: `"${file}" is a hot spot (${count} commits) — verify tests around it on every change.`,
            evidence: `${count} commits touching it`,
        });
    }
    return { rules, applied: 0, commitCount: sets.length };
}
function slug(s) {
    return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
}
/** Append learned rules to agent.config.local.yaml (review-then-promote flow) */
export function applyLearnedRules(cwd, rules) {
    const localPath = path.join(cwd, "agent.config.local.yaml");
    let doc = {};
    if (existsSync(localPath)) {
        doc = parseYaml(readFileSync(localPath, "utf8")) ?? {};
    }
    const existing = Array.isArray(doc.rules) ? doc.rules : [];
    const existingIds = new Set(existing.map((r) => r.id));
    const fresh = rules
        .filter((r) => !existingIds.has(r.id))
        .map((r) => ({ id: r.id, text: r.text }));
    if (!fresh.length)
        return 0;
    doc.rules = [...existing, ...fresh];
    writeFileSync(localPath, stringifyYaml(doc));
    return fresh.length;
}
export function learn(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const result = learnFromHistory(cwd);
    if (!result.commitCount) {
        console.log("No git history found — nothing to learn yet. Commit more code and re-run.");
        return result;
    }
    console.log(`Analyzed ${result.commitCount} commits. Suggested rules:\n`);
    for (const r of result.rules) {
        console.log(`  • [${r.id}]`);
        console.log(`    ${r.text}`);
        console.log(`    evidence: ${r.evidence}\n`);
    }
    if (!result.rules.length) {
        console.log("No strong patterns found (need ≥3 co-changing commits or ≥5 commits on one file).");
        return result;
    }
    if (options.apply) {
        const n = applyLearnedRules(cwd, result.rules);
        result.applied = n;
        if (n) {
            console.log(`✓ ${n} rule(s) appended to agent.config.local.yaml — review them, then promote to agent.config.yaml.`);
            console.log("  Next: agentos sync");
        }
        else {
            console.log("All suggested rules already present — nothing new applied.");
        }
    }
    else {
        console.log("Dry run. To apply: agentos learn --apply");
    }
    return result;
}
//# sourceMappingURL=learn.js.map