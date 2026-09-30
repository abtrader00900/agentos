import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadRun, runDir } from "../orchestrator/run.js";
import { redact, maskSecrets } from "../orchestrator/safety.js";

/** Facts agentos recorded about a finished run. They are data, not a model's opinion. */
export type Evidence =
  | { id: string; type: "verify_fixed"; command: string; failedTail: string; files: string[]; round: number }
  | { id: string; type: "finding_fixed"; severity: "high" | "medium"; file: string; issue: string }
  | { id: string; type: "fallback"; from: string; to: string; why: string; error: string }
  | { id: string; type: "conflict_resolved"; files: string[] }
  | { id: string; type: "needs_human"; reason: string }
  | { id: string; type: "planner_retry"; error: string };

type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
type Finding = { severity: string; file: string; issue: string };
const MAX = 12;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readEvents(root: string, id: string): Array<Record<string, any>> {
  const file = path.join(runDir(root, id), "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((l) => {
    try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; }
  });
}

export function collectEvidence(root: string, id: string): Evidence[] {
  const s = loadRun(root, id);
  const out: Evidence[] = [];
  const add = (e: NoId<Evidence>) => { if (out.length < MAX) out.push({ id: `E${out.length + 1}`, ...e } as Evidence); };
  let failed: { command: string; output: string } | null = null; // the first failure of a failing streak
  let fixFiles: string[] = [];
  let round = 0;
  let open: Finding[] = []; // blocking findings not yet seen fixed
  for (const e of readEvents(root, id)) {
    if (e.type === "fix") {
      fixFiles.push(...(e.files ?? []));
      round = e.round ?? round;
    } else if (e.type === "verify") {
      if (e.ok === false) {
        if (failed === null) {
          const output = String(e.output ?? "");
          // older events have no command field: fall back to the header in the output
          failed = { output, command: String(e.command || /^\$ (.+?)\s+✗ FAILED/m.exec(output)?.[1] || "(verify)") };
          fixFiles = [];
        }
        continue;
      }
      if (failed !== null) {
        add({ type: "verify_fixed", command: failed.command, failedTail: redact(failed.output).slice(-600), files: [...new Set(fixFiles)], round });
        failed = null;
        fixFiles = [];
      }
      const blocking = ((e.findings ?? []) as Finding[]).filter((f) => f.severity === "high" || f.severity === "medium");
      if (!blocking.length) {
        for (const f of open) add({ type: "finding_fixed", severity: f.severity as "high" | "medium", file: f.file, issue: redact(f.issue).slice(0, 200) });
        open = [];
      } else {
        open = blocking;
      }
    } else if (e.type === "fallback") {
      add({ type: "fallback", from: e.from, to: e.to, why: e.why, error: String(e.error ?? "") });
    } else if (e.type === "conflict-resolved") {
      add({ type: "conflict_resolved", files: e.files ?? [] });
    } else if (e.type === "planner-retry") {
      add({ type: "planner_retry", error: String(e.error ?? "") });
    }
  }
  if (s.status === "needs_human" && s.reason) add({ type: "needs_human", reason: redact(s.reason.split("\n")[0]).slice(0, 200) });
  return out;
}

/** one line for prompts and for a lesson's meta.evidence */
export function describeEvidence(e: Evidence): string {
  const text = (() => {
    switch (e.type) {
      case "verify_fixed": return `verify_fixed: \`${e.command}\` failed, fixed in round ${e.round} by changing ${e.files.join(", ") || "(no files)"}. Failure: ${e.failedTail.replace(/\s+/g, " ").slice(-160)}`;
      case "finding_fixed": return `finding_fixed: [${e.severity}] ${e.file}: ${e.issue}`;
      case "fallback": return `fallback: ${e.from} failed (${e.why}: ${e.error}), ${e.to} took over`;
      case "conflict_resolved": return `conflict_resolved: ${e.files.join(", ")}`;
      case "needs_human": return `needs_human: ${e.reason}`;
      case "planner_retry": return `planner_retry: ${e.error}`;
    }
  })();
  // mask before cutting: a token straddling the cut must not survive as a partial match
  return maskSecrets(`${e.id}: ${text}`).slice(0, 300);
}
