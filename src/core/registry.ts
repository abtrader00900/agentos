/**
 * Issue #3: community skill registry — git-based, zero API keys.
 *
 * Two parts:
 *  1. install from ANY git source: `agentos skill install owner/repo[#sub/dir]` or a full git URL.
 *  2. search: a registry index JSON (remote https or local file) listed in
 *     agent.config.yaml as `skillRegistry`, merged with bundled skills.
 *
 * Index format:
 *   { "version": 1, "skills": [{ "name", "description", "repo", "path?" }] }
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSkills, validateSkillDir, bundledSkillsRoot } from "./skills.js";
import { loadConfig } from "./loader.js";

// ---------- git install ----------

/** "owner/repo" → GitHub; an optional "#sub/dir" selects a directory inside the clone. */
function parseGitSource(source: string): { url: string; sub?: string } {
  const hash = source.lastIndexOf("#");
  const base = hash > 0 ? source.slice(0, hash) : source;
  const sub = hash > 0 ? source.slice(hash + 1).replace(/^\/+|\/+$/g, "") : "";
  const url = /^[\w.-]+\/[\w.-]+$/.test(base) ? `https://github.com/${base}.git` : base;
  return sub ? { url, sub } : { url };
}

const MAX_SKILL_DEPTH = 3;

/** Every directory holding a SKILL.md up to MAX_SKILL_DEPTH below root — covers skills/<name>/ layouts. */
function findSkillDirs(root: string, depth = 0): string[] {
  if (existsSync(path.join(root, "SKILL.md"))) return [root];
  if (depth >= MAX_SKILL_DEPTH) return [];
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(root); } catch { return out; }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const p = path.join(root, entry);
    try {
      if (statSync(p).isDirectory()) out.push(...findSkillDirs(p, depth + 1));
    } catch { /* skip unreadable */ }
  }
  return out;
}

/**
 * Validate and copy every skill directory found under `root` into the project.
 * Returns the installed skill names. `label` is what error messages call the source.
 */
export function installSkillsFromDir(root: string, projectDir: string, label = root): string[] {
  const skillDirs = findSkillDirs(root);
  if (!skillDirs.length) {
    throw new Error(`No skills (SKILL.md) found in ${label}`);
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
    cpSync(dir, dst, { recursive: true, filter: (src) => path.basename(src) !== ".git" });
    installed.push(name);
  }
  if (!installed.length) {
    throw new Error(`All skills in ${label} failed validation:\n  - ${rejected.join("\n  - ")}`);
  }
  return installed;
}

/**
 * Clone a git source and install every valid skill from it into the project.
 * Returns the installed skill names.
 */
export function installSkillsFromGit(source: string, projectDir: string): string[] {
  const { url, sub } = parseGitSource(source);
  const tmp = mkdtempSync(path.join(tmpdir(), "agentos-skill-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", url, tmp], { stdio: ["ignore", "ignore", "pipe"] });
    const root = sub ? path.resolve(tmp, sub) : tmp;
    if (sub && !root.startsWith(tmp + path.sep)) throw new Error(`Invalid path "${sub}" in ${source}`);
    if (sub && !existsSync(root)) throw new Error(`No directory "${sub}" in ${url}`);
    return installSkillsFromDir(root, projectDir, `${url}${sub ? `#${sub}` : ""}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function looksLikeGitSource(name: string): boolean {
  return name.includes("://") || name.includes("/") || name.endsWith(".git") || /^[A-Za-z]:\\/.test(name);
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
const FETCH_TIMEOUT_MS = 15_000;
const MAX_INDEX_BYTES = 5 * 1024 * 1024;

function cacheFile(): string {
  return path.join(homedir(), ".agentos", "registry-cache.json");
}

function fetchUrl(url: string, redirects = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = new URL(url).protocol === "http:" ? httpGet : httpsGet;
    const req = get(url, { headers: { "user-agent": "agentos" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) { reject(new Error(`Too many redirects from ${url}`)); return; }
        resolve(fetchUrl(new URL(res.headers.location, url).href, redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status} from ${url}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => {
        body += d;
        if (body.length > MAX_INDEX_BYTES) req.destroy(new Error(`Registry index at ${url} exceeds ${MAX_INDEX_BYTES} bytes`));
      });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error(`Timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching ${url}`)));
  });
}

/** Remote data is untrusted: keep only well-formed entries so one bad row cannot crash search. */
function normalizeIndex(raw: unknown, from: string): RegistryIndex {
  const idx = raw as { version?: unknown; skills?: unknown } | null;
  if (!idx || typeof idx !== "object" || !Array.isArray(idx.skills)) {
    throw new Error(`Invalid registry index at ${from}: expected { "version": 1, "skills": [...] }`);
  }
  const skills: RegistryEntry[] = [];
  for (const e of idx.skills as unknown[]) {
    const o = e as Partial<Record<keyof RegistryEntry, unknown>> | null;
    if (!o || typeof o !== "object" || typeof o.name !== "string" || !o.name) continue;
    skills.push({
      name: o.name,
      description: typeof o.description === "string" ? o.description : "",
      repo: typeof o.repo === "string" ? o.repo : undefined,
      path: typeof o.path === "string" ? o.path : undefined,
    });
  }
  return { version: typeof idx.version === "number" ? idx.version : 1, skills };
}

/** Load the index: local path / file:// direct read, http(s) with a 5-min disk cache. */
export async function loadRegistryIndex(registryUrl: string): Promise<RegistryIndex> {
  if (registryUrl.startsWith("file://")) {
    const p = fileURLToPath(registryUrl);
    return normalizeIndex(JSON.parse(readFileSync(p, "utf8")), p);
  }
  if (!registryUrl.includes("://")) {
    return normalizeIndex(JSON.parse(readFileSync(registryUrl, "utf8")), registryUrl);
  }

  const cache = cacheFile();
  try {
    const cached = JSON.parse(readFileSync(cache, "utf8")) as { at: number; url?: string; index: RegistryIndex };
    if (cached.url === registryUrl && Date.now() - cached.at < CACHE_TTL_MS) return cached.index;
  } catch { /* no/invalid cache */ }

  const body = await fetchUrl(registryUrl);
  const index = normalizeIndex(JSON.parse(body), registryUrl);
  try {
    mkdirSync(path.dirname(cache), { recursive: true });
    writeFileSync(cache, JSON.stringify({ at: Date.now(), url: registryUrl, index }));
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
      for (const e of index.skills) {
        if (e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)) {
          results.push({ ...e, origin: "registry" });
        }
      }
    } catch (e) {
      throw new Error(`Registry unreachable (${registryUrl}): ${(e as Error).message}`);
    }
  }

  return results;
}

/** Look a skill name up in the configured registry (`skill install <name>` for a non-bundled skill). */
export async function resolveRegistryEntry(name: string, cwd: string): Promise<RegistryEntry | null> {
  let registryUrl: string | undefined;
  try {
    registryUrl = loadConfig(cwd).config.skillRegistry;
  } catch {
    return null;
  }
  if (!registryUrl) return null;
  const index = await loadRegistryIndex(registryUrl);
  return index.skills.find((e) => e.name === name) ?? null;
}
