import { execSync } from "node:child_process";
import { z } from "zod";
const tail = (s, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);
/** Run the configured commands through the shell, in order, stopping at the first failure. */
export function runVerify(cwd, commands, timeoutMs) {
    let output = "";
    for (const cmd of commands) {
        try {
            // the commands come from the owner's own agent.config.yaml, never from an agent
            const out = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
            output += `$ ${cmd}\n${tail(out, 1500)}\n`;
        }
        catch (e) {
            const err = e;
            output += `$ ${cmd}  ✗ FAILED\n${tail(`${err.stdout ?? ""}${err.stderr ?? ""}` || err.message)}\n`;
            return { ok: false, output };
        }
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
export function reviewPrompt(task, diff, notes = "") {
    return [
        "You are reviewing a change another AI agent made. Do not edit any files.",
        `The task was: ${task}`,
        "Report real problems only: wrong behaviour, crashes, security holes, data loss, or parts of the task left undone. Ignore style.",
        'Reply with ONLY a JSON array, for example [{"severity":"high","file":"src/a.ts","line":12,"issue":"what breaks and when"}]. Use [] when you find nothing. severity is high, medium or low.',
        notes,
        "The diff:",
        diff.length > 150_000 ? `${diff.slice(0, 150_000)}\n…(diff truncated)` : diff,
    ]
        .filter(Boolean)
        .join("\n\n");
}
//# sourceMappingURL=verify.js.map