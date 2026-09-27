import path from "node:path";
import { exportHandoff, writeHandoff, importHandoff, latestHandoffDir, bundleToMarkdown } from "../core/handoff.js";
import { ALL_HARNESSES } from "../core/schema.js";
function splitList(s) {
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}
const VALID = [...ALL_HARNESSES, "any"];
export function handoff(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    for (const [flag, value] of [["--to", options.to], ["--from", options.from]]) {
        if (value !== undefined && !VALID.includes(value)) {
            throw new Error(`Unknown harness "${value}" for ${flag}. Valid: ${VALID.join(", ")}`);
        }
    }
    if (!options.task) {
        throw new Error("Task description required.\n" +
            'Example: agentos handoff --to codex --task "Half-done: invoice PDF export, queue job written, blade template missing"');
    }
    const bundle = exportHandoff(cwd, {
        task: options.task,
        filesInProgress: splitList(options.files),
        pendingDecisions: splitList(options.decisions),
        openQuestions: splitList(options.questions),
        notes: options.notes,
        fromHarness: options.from ?? detectHarness(),
        toHarness: options.to ?? "any",
    });
    const { dir, rootMd } = writeHandoff(cwd, bundle);
    console.log(`✓ Handoff bundle written:`);
    console.log(`    ${dir}/bundle.json`);
    console.log(`    ${rootMd}  (auto-included in harness configs on next sync)`);
    console.log(`\nNext: open ${bundle.toHarness === "any" ? "your next agent" : bundle.toHarness} — it receives the full context.`);
}
export function handoffShow(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const dir = latestHandoffDir(cwd);
    if (!dir)
        throw new Error("No handoff bundles found in .agentos/handoffs/");
    const bundle = importHandoff(path.join(dir, "bundle.json"));
    console.log(bundleToMarkdown(bundle));
}
/**
 * Which harness is running this command, from the environment it gives its shell.
 * (The old "newest marker file" guess always answered whichever file sync wrote last.)
 */
export function detectHarness(env = process.env) {
    if (env.CLAUDECODE)
        return "claude-code";
    if (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED)
        return "codex";
    if (env.CURSOR_TRACE_ID)
        return "cursor";
    return "unknown";
}
//# sourceMappingURL=handoff.js.map