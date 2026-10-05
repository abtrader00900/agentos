import { spawn } from "node:child_process";
import { z } from "zod";
import { killTree } from "./runners.js";
const tail = (s, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);
/** a long text cut to its head and tail: the error message sits at the top, the summary at the bottom */
export function excerpt(text, max = 600) {
    if (text.length <= max)
        return text;
    const half = Math.floor((max - 3) / 2);
    return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}
/**
 * One shell command, async so the engine can review while the tests run. Its own process group,
 * so a timeout or a cancel (through `live`) kills the test runner too, not just the shell.
 */
function sh(cmd, cwd, timeoutMs, live) {
    return new Promise((resolve) => {
        // the commands come from the owner's own agent.config.yaml, never from an agent
        const child = spawn(cmd, { cwd, shell: true, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const pid = child.pid ?? 0;
        if (pid)
            live?.add(pid);
        let out = "";
        let timedOut = false;
        const add = (d) => { out = (out + d).slice(-8_000_000); };
        child.stdout.setEncoding("utf8").on("data", add);
        child.stderr.setEncoding("utf8").on("data", add);
        const timer = setTimeout(() => { timedOut = true; if (pid)
            killTree(pid); }, timeoutMs);
        const done = (ok, extra = "") => { clearTimeout(timer); live?.delete(pid); resolve({ ok, out: out + extra }); };
        child.on("error", (e) => done(false, e.message));
        child.on("close", (code) => done(code === 0 && !timedOut, timedOut ? `\n(timed out after ${Math.round(timeoutMs / 1000)} s)` : ""));
    });
}
/** Run the configured commands through the shell, in order, stopping at the first failure. */
export async function runVerify(cwd, commands, timeoutMs, live) {
    let output = "";
    for (const cmd of commands) {
        const r = await sh(cmd, cwd, timeoutMs, live);
        if (!r.ok)
            return { ok: false, output: `${output}$ ${cmd}  ✗ FAILED\n${tail(r.out)}\n` };
        output += `$ ${cmd}\n${tail(r.out, 1500)}\n`;
    }
    return { ok: true, output };
}
const findingsSchema = z.array(z.object({
    severity: z.enum(["high", "medium", "low"]),
    file: z.string().default(""),
    line: z.number().int().nonnegative().default(0),
    issue: z.string().min(1),
}));
/** The findings array that ends the reviewer's reply; null when there is none. */
export function parseFindings(text) {
    const s = text.replace(/```(?:json)?/g, "");
    const end = s.lastIndexOf("]");
    for (let start = s.lastIndexOf("[", end); start >= 0; start = start === 0 ? -1 : s.lastIndexOf("[", start - 1)) {
        try {
            const r = findingsSchema.safeParse(JSON.parse(s.slice(start, end + 1)));
            if (r.success)
                return r.data;
        }
        catch {
            /* widen to the previous "[" */
        }
    }
    return null;
}
export const blocking = (findings) => findings.filter((f) => f.severity !== "low");
const FORMAT = 'Reply with ONLY a JSON array, for example [{"severity":"high","file":"src/a.ts","line":12,"issue":"what breaks and when"}]. Use [] when you find nothing. severity is high, medium or low.';
// Spec Kit's "converge" step, folded into the review instead of a separate agent call
const CONVERGE = 'Split the task into its separate requirements and check each one against the change. Report every requirement it does not meet as a finding with severity medium and an issue that starts with "Not done: " followed by the requirement.';
const capped = (diff) => (diff.length > 150_000 ? `${diff.slice(0, 150_000)}\n…(diff truncated)` : diff);
export function reviewPrompt(task, diff, notes = "") {
    return [
        "You are reviewing a change another AI agent made. Do not edit any files.",
        `The task was: ${task}`,
        "Report real problems only: wrong behaviour, crashes, security holes, data loss, or parts of the task left undone. Ignore style.",
        CONVERGE,
        FORMAT,
        notes,
        "The diff:",
        capped(diff),
    ]
        .filter(Boolean)
        .join("\n\n");
}
/**
 * The review after a fix round: the earlier findings plus only the fixer's diff, so the reviewer
 * checks the fix instead of re-reading the whole change (and finding new nits in it) every round.
 */
export function reReviewPrompt(task, earlier, fixDiff, base, changedFiles, notes = "") {
    const listed = earlier.map((f) => `- [${f.severity}] ${f.file}:${f.line} ${f.issue}`).join("\n");
    return [
        "You reviewed a change another AI agent made and reported problems; a fixer has since edited it. Do not edit any files.",
        `The task was: ${task}`,
        `Your earlier findings:\n${listed || "(none: only the tests failed)"}`,
        `Check that each earlier finding is really fixed, and that the fix broke nothing and left no part of the task undone. The diff below is only the fixer's change. The whole change touches: ${changedFiles.join(", ") || "(no files)"}; read those files (or run \`git diff ${base}..HEAD\` if you can) for context. Report real problems that remain or that the fix caused; ignore style.`,
        CONVERGE,
        FORMAT,
        notes,
        "The fixer's diff:",
        fixDiff.trim() ? capped(fixDiff) : "(the fixer changed nothing)",
    ]
        .filter(Boolean)
        .join("\n\n");
}
//# sourceMappingURL=verify.js.map