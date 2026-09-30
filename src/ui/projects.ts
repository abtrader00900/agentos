import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { retrying, withLock } from "../core/jsonstore.js";

/**
 * The folders the dashboard knows about, kept in ~/.agentos/projects.json.
 *
 * Nothing here is authoritative — it is a list of paths a run has visited, so a
 * broken or missing registry only costs the dashboard a row, never a run.
 */

export interface Project { id: string; name: string; path: string; addedAt: string; lastSeen: string }

export const agentosHome = (): string => process.env.AGENTOS_HOME || os.homedir();

export const registryFile = (home = agentosHome()): string => path.join(home, ".agentos", "projects.json");

/** identity of a folder: on win32 two paths differing only in case are the same folder */
const key = (root: string): string => {
  const abs = path.resolve(root);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
};

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "") || "project";

/** readable but unique enough to appear in a URL */
export function projectId(root: string): string {
  return `${slug(path.basename(path.resolve(root)))}-${createHash("sha1").update(key(root)).digest("hex").slice(0, 4)}`;
}

const isProject = (p: unknown): p is Project =>
  !!p && typeof p === "object" &&
  (["id", "name", "path", "addedAt", "lastSeen"] as const).every((k) => typeof (p as Record<string, unknown>)[k] === "string");

/**
 * A registry that is absent, not a JSON array, or holds malformed entries reads
 * as empty (the next write replaces it). An I/O error is NOT corruption — it is
 * retried and then surfaces, because reporting an empty registry would let the
 * next write make that true and drop every project we failed to read.
 */
function read(home: string): Project[] {
  let text: string;
  try {
    text = retrying(() => readFileSync(registryFile(home), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isProject) : [];
  } catch {
    return [];
  }
}

/**
 * Read-modify-write under a cross-process lock, so two runs starting at once
 * each see the other's entry instead of overwriting it. The rename is atomic.
 */
function update<T>(home: string, fn: (projects: Project[]) => T): T {
  const file = registryFile(home);
  return withLock(file, () => {
    const projects = read(home);
    const result = fn(projects);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(projects, null, 2));
    try {
      retrying(() => renameSync(tmp, file));
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* already gone */ }
      throw e;
    }
    return result;
  });
}

/** Add the folder if it is new, otherwise just refresh lastSeen. Returns the stored entry. */
export function registerProject(root: string, home = agentosHome()): Project {
  const dir = path.resolve(root);
  return update(home, (projects) => {
    const now = new Date().toISOString();
    let entry = projects.find((p) => key(p.path) === key(dir));
    if (entry) {
      entry.lastSeen = now;
    } else {
      entry = { id: projectId(dir), name: path.basename(dir), path: dir, addedAt: now, lastSeen: now };
      projects.push(entry);
    }
    return entry;
  });
}

export const listProjects = (home = agentosHome()): Array<Project & { missing: boolean }> =>
  read(home).map((p) => ({ ...p, missing: !existsSync(p.path) }));

export const getProject = (id: string, home = agentosHome()): Project | undefined =>
  read(home).find((p) => p.id === id);

export function removeProject(id: string, home = agentosHome()): boolean {
  return update(home, (projects) => {
    const i = projects.findIndex((p) => p.id === id);
    if (i < 0) return false;
    projects.splice(i, 1);
    return true;
  });
}
