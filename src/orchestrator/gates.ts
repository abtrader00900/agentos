import path from "node:path";
import type { Finding } from "./types.js";

/**
 * Smart gates (PRD 4.5): deterministic checks that tell the owner where a PR needs a human.
 * Pure functions: the engine feeds them git output and agent text.
 */

export interface Change { path: string; added: number; deleted: number }
export interface RiskRule { name: string; action: "flag" | "block"; paths?: string[]; deletedLines?: number }
export interface RiskFlag { rule: string; action: "flag" | "block"; files: string[] }
export interface AgentReport { changed: string[]; notDone: string[]; assumed: string[]; notVerified: string[] }

/** `**` crosses folders, `*` and `?` stay inside one; everything else is literal */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** a glob without a slash names a file anywhere (like .gitignore); one with a slash is anchored at the root */
export const matchesGlob = (file: string, glob: string): boolean =>
  globToRegExp(glob).test(glob.includes("/") ? file : path.posix.basename(file));

/** `git diff --numstat --no-renames` lines; binary files ("-") count as 0 */
export function parseNumstat(out: string): Change[] {
  return out
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 3 && p[2])
    .map(([a, d, file]) => ({ path: file, added: Number(a) || 0, deleted: Number(d) || 0 }));
}

export const DEFAULT_RISK: RiskRule[] = [
  { name: "migration", action: "flag", paths: ["**/migrations/**", "**/*.sql"] },
  { name: "ci-deploy", action: "flag", paths: [".github/workflows/**", "Dockerfile", "docker-compose*.yml", "railway.*", "Procfile", "vercel.json"] },
  { name: "lockfile", action: "flag", paths: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "composer.lock"] },
  { name: "auth", action: "flag", paths: ["**/auth/**", "**/*Policy*", "**/middleware/**", "**/permissions*"] },
  { name: "env-config", action: "flag", paths: [".env.example", "config/**"] },
  { name: "big-delete", action: "flag", deletedLines: 200 },
];

/** which rules this change trips, each with the files that tripped it (a big deletion lists the files that lost most) */
export function riskFlags(changes: Change[], rules: RiskRule[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  for (const r of rules) {
    if (r.paths) {
      const files = changes.filter((c) => r.paths!.some((g) => matchesGlob(c.path, g))).map((c) => c.path);
      if (files.length) flags.push({ rule: r.name, action: r.action, files });
    } else if (r.deletedLines !== undefined) {
      const total = changes.reduce((n, c) => n + c.deleted, 0);
      if (total >= r.deletedLines) {
        const files = changes.filter((c) => c.deleted > 0).sort((a, b) => b.deleted - a.deleted).slice(0, 10).map((c) => c.path);
        flags.push({ rule: r.name, action: r.action, files });
      }
    }
  }
  return flags;
}

const TEST_FILE = [
  /(^|\/)(tests?|__tests__|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /Test\.php$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.(go|py)$/,
];
const isTestFile = (f: string) => TEST_FILE.some((re) => re.test(f));
const SKIP = /\b(?:it|test|describe)\.(?:skip|only)\s*\(|\.only\s*\(|\bx(?:it|describe|test)\s*\(|\bmarkTestSkipped\s*\(|->skip\s*\(|@pytest\.mark\.skip|\bt\.Skip\s*\(|@Ignore\b|@Disabled\b/;
const ASSERT = /\b(?:expect|assert\w*|should)\b|->assert/;
/** the task itself asks to change tests: "remove the old login test", not "tests must pass" */
const ASKED = /\b(remove|delete|drop|skip|disable|rewrite|replace)\b[^.\n]{0,40}\btests?\b/i;
const MAX_DIFF = 2_000_000;

/** Tests weakened to pass: new skip/only markers, deleted test files, fewer assertions. */
export function tamperFindings(diff: string, task: string): Finding[] {
  if (diff.length > MAX_DIFF) return [{ severity: "low", file: "", line: 0, issue: "diff too large to scan for test tampering" }];
  const files = new Map<string, { deleted: boolean; skips: number; added: number; removed: number }>();
  let cur: { deleted: boolean; skips: number; added: number; removed: number } | undefined;
  for (const line of diff.split("\n")) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) {
      cur = isTestFile(head[2]) ? { deleted: false, skips: 0, added: 0, removed: 0 } : undefined;
      if (cur) files.set(head[2], cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("deleted file mode")) cur.deleted = true;
    else if (line.startsWith("+") && !line.startsWith("+++")) {
      if (SKIP.test(line)) cur.skips++;
      if (ASSERT.test(line)) cur.added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      if (ASSERT.test(line)) cur.removed++;
    }
  }
  const asked = ASKED.test(task);
  const sev = (s: Finding["severity"]): Finding["severity"] => (asked ? "low" : s);
  const out: Finding[] = [];
  for (const [file, f] of files) {
    if (f.deleted) out.push({ severity: sev("high"), file, line: 0, issue: "a test file was deleted" });
    else {
      if (f.skips) out.push({ severity: sev("high"), file, line: 0, issue: `a test was skipped or focused (${f.skips} skip/only marker${f.skips > 1 ? "s" : ""} added)` });
      if (f.removed > f.added) out.push({ severity: sev("medium"), file, line: 0, issue: `fewer assertions than before (${f.removed} removed, ${f.added} added): check no test was weakened` });
    }
  }
  return out;
}

const HEADS: Record<string, keyof AgentReport> = { "CHANGED": "changed", "NOT DONE": "notDone", "ASSUMED": "assumed", "NOT VERIFIED": "notVerified" };
const NONE = /^(none|n\/a|nothing|-)\.?$/i;

/** the four parts of an agent's closing report; null when it gave none */
export function parseReport(text: string): AgentReport | null {
  const re = /^[\s>*_-]*(CHANGED|NOT\s+DONE|ASSUMED|NOT\s+VERIFIED)[\s*_]*:[\s*_]*(.*)$/gim;
  const hits = [...text.matchAll(re)];
  if (!hits.length) return null;
  const out: AgentReport = { changed: [], notDone: [], assumed: [], notVerified: [] };
  hits.forEach((m, i) => {
    const key = HEADS[m[1].toUpperCase().replace(/\s+/g, " ")];
    const end = i + 1 < hits.length ? hits[i + 1].index! : text.length;
    const body = `${m[2]}\n${text.slice(m.index! + m[0].length, end)}`;
    out[key].push(...body.split(/\n|;\s+/).map((x) => x.replace(/^[\s*-]+/, "").trim()).filter((x) => x && !NONE.test(x)));
  });
  return out;
}

export const REPORT_INSTRUCTIONS = [
  "End your final message with this report (one line per part; write \"none\" when empty):",
  "CHANGED: the files you changed and why",
  "NOT DONE: any part of the task you did not do",
  "ASSUMED: anything you assumed instead of checking",
  "NOT VERIFIED: anything you could not run or check",
].join("\n");

export const REVIEW_GATES = [
  "Also check:",
  "- Tests made weaker to pass: a looser assertion, a mocked-away subject, a lowered threshold, a skipped case. Each is a finding.",
  "- The workers' reports below: every claim must be backed by the diff. A claim the diff does not support is a finding.",
].join("\n");
