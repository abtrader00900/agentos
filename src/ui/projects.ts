import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { retrying } from "../core/jsonstore.js";

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

/** a registry that is absent, unreadable or not a JSON array reads as empty; the next write replaces it */
function read(home: string): Project[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(registryFile(home), "utf8"));
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

function write(home: string, projects: Project[]): void {
  const file = registryFile(home);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(projects, null, 2));
  try {
    retrying(() => renameSync(tmp, file));
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** Add the folder if it is new, otherwise just refresh lastSeen. Returns the stored entry. */
export function registerProject(root: string, home = agentosHome()): Project {
  const dir = path.resolve(root);
  const projects = read(home);
  const now = new Date().toISOString();
  let entry = projects.find((p) => key(p.path) === key(dir));
  if (entry) {
    entry.lastSeen = now;
  } else {
    entry = { id: projectId(dir), name: path.basename(dir), path: dir, addedAt: now, lastSeen: now };
    projects.push(entry);
  }
  write(home, projects);
  return entry;
}

export const listProjects = (home = agentosHome()): Array<Project & { missing: boolean }> =>
  read(home).map((p) => ({ ...p, missing: !existsSync(p.path) }));

export const getProject = (id: string, home = agentosHome()): Project | undefined =>
  read(home).find((p) => p.id === id);

export function removeProject(id: string, home = agentosHome()): boolean {
  const projects = read(home);
  const left = projects.filter((p) => p.id !== id);
  if (left.length === projects.length) return false;
  write(home, left);
  return true;
}
