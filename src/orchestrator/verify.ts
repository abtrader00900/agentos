import { exec } from "node:child_process";
import { z } from "zod";
import type { Finding } from "./types.js";

const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);

/** a long text cut to its head and tail: the error message sits at the top, the summary at the bottom */
export function excerpt(text: string, max = 600): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 3) / 2);
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

/** one shell command, async so the engine can review while the tests run */
function sh(cmd: string, cwd: string, timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    // the commands come from the owner's own agent.config.yaml, never from an agent
    const child = exec(cmd, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      resolve(err ? { ok: false, out: `${stdout}${stderr}` || err.message } : { ok: true, out: stdout }),
    );
    child.stdin?.end();
  });
}

/** Run the configured commands through the shell, in order, stopping at the first failure. */
export async function runVerify(cwd: string, commands: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  let output = "";
  for (const cmd of commands) {
    const r = await sh(cmd, cwd, timeoutMs);
    if (!r.ok) return { ok: false, output: `${output}$ ${cmd}  ✗ FAILED\n${tail(r.out)}\n` };
    output += `$ ${cmd}\n${tail(r.out, 1500)}\n`;
  }
  return { ok: true, output };
}

const findingsSchema = z.array(
  z.object({
    severity: z.enum(["high", "medium", "low"]),
    file: z.string().default(""),
    line: z.number().int().nonnegative().default(0),
    issue: z.string().min(1),
  }),
);

/** The findings array that ends the reviewer's reply; null when there is none. */
export function parseFindings(text: string): Finding[] | null {
  const s = text.replace(/```(?:json)?/g, "");
  const end = s.lastIndexOf("]");
  for (let start = s.lastIndexOf("[", end); start >= 0; start = start === 0 ? -1 : s.lastIndexOf("[", start - 1)) {
    try {
      const r = findingsSchema.safeParse(JSON.parse(s.slice(start, end + 1)));
      if (r.success) return r.data;
    } catch {
      /* widen to the previous "[" */
    }
  }
  return null;
}

export const blocking = (findings: Finding[]) => findings.filter((f) => f.severity !== "low");

const FORMAT = 'Reply with ONLY a JSON array, for example [{"severity":"high","file":"src/a.ts","line":12,"issue":"what breaks and when"}]. Use [] when you find nothing. severity is high, medium or low.';
const capped = (diff: string) => (diff.length > 150_000 ? `${diff.slice(0, 150_000)}\n…(diff truncated)` : diff);

export function reviewPrompt(task: string, diff: string, notes = ""): string {
  return [
    "You are reviewing a change another AI agent made. Do not edit any files.",
    `The task was: ${task}`,
    "Report real problems only: wrong behaviour, crashes, security holes, data loss, or parts of the task left undone. Ignore style.",
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
export function reReviewPrompt(task: string, earlier: Finding[], fixDiff: string, base: string, notes = ""): string {
  const listed = earlier.map((f) => `- [${f.severity}] ${f.file}:${f.line} ${f.issue}`).join("\n");
  return [
    "You reviewed a change another AI agent made and reported problems; a fixer has since edited it. Do not edit any files.",
    `The task was: ${task}`,
    `Your earlier findings:\n${listed || "(none: only the tests failed)"}`,
    `Check that each earlier finding is really fixed, and that the fix broke nothing and left no part of the task undone. The diff below is only the fixer's change; run \`git diff ${base}..HEAD\` in this directory to see the whole change. Report real problems that remain or that the fix caused; ignore style.`,
    FORMAT,
    notes,
    "The fixer's diff:",
    fixDiff.trim() ? capped(fixDiff) : "(the fixer changed nothing)",
  ]
    .filter(Boolean)
    .join("\n\n");
}
