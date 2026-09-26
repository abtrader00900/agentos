import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { exportHandoff, writeHandoff, importHandoff, latestHandoffDir, bundleToMarkdown } from "../core/handoff.js";
import { HARNESS_MARKER } from "../generators/index.js";

/** FR-2.5 / FR-7.x: agentos handoff */

export interface HandoffOptions {
  cwd?: string;
  to?: string;
  from?: string;
  task?: string;
  files?: string;
  decisions?: string;
  questions?: string;
  notes?: string;
}

function splitList(s?: string): string[] {
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

export function handoff(options: HandoffOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();

  if (!options.task) {
    throw new Error(
      "Task description required.\n" +
        'Example: agentos handoff --to codex --task "Half-done: invoice PDF export, queue job written, blade template missing"',
    );
  }

  const bundle = exportHandoff(cwd, {
    task: options.task,
    filesInProgress: splitList(options.files),
    pendingDecisions: splitList(options.decisions),
    openQuestions: splitList(options.questions),
    notes: options.notes,
    fromHarness: options.from ?? detectHarness(cwd),
    toHarness: options.to ?? "any",
  });

  const { dir, rootMd } = writeHandoff(cwd, bundle);
  console.log(`✓ Handoff bundle written:`);
  console.log(`    ${dir}/bundle.json`);
  console.log(`    ${rootMd}  (auto-included in harness configs on next sync)`);
  console.log(`\nNext: open ${bundle.toHarness === "any" ? "your next agent" : bundle.toHarness} — it receives the full context.`);
}

export function handoffShow(options: { cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const dir = latestHandoffDir(cwd);
  if (!dir) throw new Error("No handoff bundles found in .agentos/handoffs/");
  const bundle = importHandoff(path.join(dir, "bundle.json"));
  console.log(bundleToMarkdown(bundle));
}

export function detectHarness(cwd: string): string {
  // best-effort: which harness config was touched most recently
  const candidates = Object.entries(HARNESS_MARKER);
  let best: [string, number] = ["unknown", 0];
  for (const [name, file] of candidates) {
    const p = path.join(cwd, file);
    if (!existsSync(p)) continue;
    const mtime = statSync(p).mtimeMs;
    if (mtime > best[1]) best = [name, mtime];
  }
  return best[0];
}
