import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/loader.js";
import { generators } from "../generators/index.js";
import { writeManifest, hashContent, readManifest, detectDrift, type ManifestEntry } from "../core/manifest.js";
import type { HarnessName } from "../core/schema.js";

export interface SyncOptions {
  cwd?: string;
  /** Only sync these harnesses */
  only?: HarnessName[];
  /** Overwrite drifted (hand-edited) files without prompting */
  force?: boolean;
  quiet?: boolean;
}

const log = (msg: string, quiet?: boolean) => { if (!quiet) console.log(msg); };

export function sync(options: SyncOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const { config, sources } = loadConfig(cwd);

  // drift check before overwrite (FR-1.6)
  const targets = options.only ?? (Object.keys(generators) as HarnessName[]);
  const planned = new Map<string, string>();
  for (const h of targets) {
    for (const f of generators[h].generate(config)) planned.set(f.path, f.content);
  }
  const drift = detectDrift(cwd, planned);
  const willOverwrite = drift.drifted;
  if (willOverwrite.length && !options.force) {
    throw new Error(
      `Drift detected in:\n  ${willOverwrite.join("\n  ")}\n\n` +
        `These files were edited by hand after the last sync.\n` +
        `Re-run with --force to overwrite, or move your edits into agent.config.yaml.`,
    );
  }

  const entries: ManifestEntry[] = [];
  // FR-7.3: inject latest handoff into generated markdown configs so the
  // target harness auto-receives pending context on next sync.
  const handoffPath = path.join(cwd, "HANDOFF.md");
  const handoff = existsSync(handoffPath) ? readFileSync(handoffPath, "utf8") : null;

  for (const h of targets) {
    for (const file of generators[h].generate(config)) {
      const content = handoff && file.path.endsWith(".md")
        ? file.content + "\n## Active Handoff (AgentOS)\n\n" + handoff
        : file.content;
      const abs = path.join(cwd, file.path);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      entries.push({ path: file.path, generatedHash: hashContent(content), writtenHash: hashContent(content) });
      log(`  ✓ ${file.path}`, options.quiet);
    }
  }
  writeManifest(cwd, entries);
  log(`Synced ${entries.length} files from ${sources.length} config source(s).`, options.quiet);
}

export { detectDrift, readManifest };
