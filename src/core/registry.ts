/**
 * Issue #3: community skill registry — git-based, zero API keys.
 *
 * Two parts:
 *  1. install from ANY git source: `agentos skill install owner/repo` or a full git URL.
 *  2. search: a registry index JSON (remote https or local file) listed in
 *     agent.config.yaml as `skillRegistry`, merged with bundled skills.
 *
 * Index format:
 *   { "version": 1, "skills": [{ "name", "description", "repo", "path?" }] }
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { listSkills, validateSkillDir, bundledSkillsRoot } from "./skills.js";
import { loadConfig } from "./loader.js";

// ---------- git install ----------

function expandGitSource(source: string): string {
  // "owner/repo" shorthand → github
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) return `https://github.com/${source}.git`;
  return source;
}

function findSkillDirs(root: string): string[] {
  const out: string[] = [];
  if (existsSync(path.join(root, "SKILL.md"))) return [root];
  for (const entry of readdirSync(root)) {
    const p = path.join(root, entry);
    try {
      if (statSync(p).isDirectory() && !entry.startsWith(".") && existsSync(path.join(p, "SKILL.md"))) {
        out.push(p);
      }
    } catch { /* skip unreadable */ }
  }
  return out;
}

/**
 * Clone a git source and install every valid skill from it into the project.
 * Returns the installed skill names.
 */
export function installSkillsFromGit(source: string, projectDir: string): string[] {
  const url = expandGitSource(source);
  const tmp = mkdtempSync(path.join(tmpdir(), "agentos-skill-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", url, tmp], { stdio: ["ignore", "ignore", "pipe"] });
    const skillDirs = findSkillDirs(tmp);
    if (!skillDirs.length) {
      throw new Error(`No skills (SKILL.md) found in ${url}`);
    }
    const dstRoot = path.join(projectDir, ".agentos", "skills");
    const installed: string[] = [];
    const rejected: string[] = [];
    for (const dir of skillDirs) {
      const check = validateSkillDir(dir);
      if (!check.ok) {
        rejected.push(`${path.basename(dir)}: ${check.issues.join(", ")}`);
        continue;
      }
      const name = path.basename(dir);
      const dst = path.join(dstRoot, name);
      rmSync(dst, { recursive: true, force: true });
      cpSync(dir, dst, { recursive: true });
      installed.push(name);
    }
    if (!installed.length) {
      throw new Error(`All skills in ${url} failed validation:\n  - ${rejected.join("\n  - ")}`);
    }
    return installed;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function looksLikeGitSource(name: string): boolean {
  return name.includes("://") || name.includes("/") || name.endsWith(".git");
}

// ---------- registry index ----------

export interface RegistryEntry {
  name: string;
  description: string;
  repo?: string;
  path?: string;
}

export interface RegistryIndex {
  version: number;
  skills: RegistryEntry[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheFile(): string {
  return path.join(homedir(), ".agentos", "registry-cache.json");
}

function fetchHttps(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    httpsGet(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

/** Load the index: local path / file:// direct read, https with 5-min disk cache. */
export async function loadRegistryIndex(registryUrl: string): Promise<RegistryIndex> {
  if (registryUrl.startsWith("file://")) {
    return JSON.parse(readFileSync(registryUrl.slice("file://".length), "utf8")) as RegistryIndex;
  }
  if (!registryUrl.includes("://")) {
    return JSON.parse(readFileSync(registryUrl, "utf8")) as RegistryIndex;
  }

  const cache = cacheFile();
  try {
    const cached = JSON.parse(readFileSync(cache, "utf8")) as { at: number; index: RegistryIndex };
    if (Date.now() - cached.at < CACHE_TTL_MS) return cached.index;
  } catch { /* no/invalid cache */ }

  const body = await fetchHttps(registryUrl);
  const index = JSON.parse(body) as RegistryIndex;
  try {
    writeFileSync(cache, JSON.stringify({ at: Date.now(), index }));
  } catch { /* cache write is best-effort */ }
  return index;
}

export interface SearchResult extends RegistryEntry {
  origin: "bundled" | "registry";
}

/** Search bundled skills + configured registry index by name/description substring. */
export async function searchSkills(query: string, cwd: string): Promise<SearchResult[]> {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const s of listSkills(bundledSkillsRoot())) {
    if (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) {
      results.push({ name: s.name, description: s.description, origin: "bundled" });
    }
  }

  let registryUrl: string | undefined;
  try {
    registryUrl = loadConfig(cwd).config.skillRegistry;
  } catch { /* no config — bundled only */ }
  if (registryUrl) {
    try {
      const index = await loadRegistryIndex(registryUrl);
      for (const e of index.skills ?? []) {
        if (e.name.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q)) {
          results.push({ ...e, origin: "registry" });
        }
      }
    } catch (e) {
      throw new Error(`Registry unreachable (${registryUrl}): ${(e as Error).message}`);
    }
  }

  return results;
}
