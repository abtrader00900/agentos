import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { installSkillsFromGit, looksLikeGitSource, loadRegistryIndex, searchSkills } from "../src/core/registry.js";
import { listSkills } from "../src/core/skills.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "agentos-reg-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Create a local git repo containing a valid skill. Returns the repo path. */
function makeSkillRepo(name = "my-skill"): string {
  const repo = mkdtempSync(path.join(tmpdir(), "agentos-git-"));
  mkdirSync(path.join(repo, name, "test"), { recursive: true });
  writeFileSync(path.join(repo, name, "SKILL.md"), `---
name: ${name}
description: Test skill for registry install. Use when testing registry installs.
---

# ${name}

## Workflow

Do the thing.

## Rules

- Rule one
- Rule two
`);
  writeFileSync(path.join(repo, name, "test", "skill.test.mjs"), "// noop\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: repo });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "skill"], { cwd: repo });
  return repo;
}

describe("community skill registry (Issue #3)", () => {
  it("looksLikeGitSource detects git-ish names", () => {
    expect(looksLikeGitSource("owner/repo")).toBe(true);
    expect(looksLikeGitSource("https://github.com/x/y.git")).toBe(true);
    expect(looksLikeGitSource("tdd-laravel")).toBe(false);
  });

  it("installs a valid skill from a local git repo", () => {
    const repo = makeSkillRepo("git-skill");
    const installed = installSkillsFromGit(repo, dir);
    expect(installed).toEqual(["git-skill"]);
    const skills = listSkills(path.join(dir, ".agentos", "skills"));
    expect(skills.map((s) => s.name)).toContain("git-skill");
    rmSync(repo, { recursive: true, force: true });
  });

  it("rejects repos where all skills fail validation", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "agentos-git-"));
    mkdirSync(path.join(repo, "bad", "test"), { recursive: true });
    writeFileSync(path.join(repo, "bad", "SKILL.md"), "---\nname: bad\ndescription: short\n---\n\n# bad\n");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: repo });
    expect(() => installSkillsFromGit(repo, dir)).toThrow(/validation/);
    rmSync(repo, { recursive: true, force: true });
  });

  it("throws when no SKILL.md exists in repo", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "agentos-git-"));
    writeFileSync(path.join(repo, "README.md"), "nothing here");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: repo });
    expect(() => installSkillsFromGit(repo, dir)).toThrow(/No skills/);
    rmSync(repo, { recursive: true, force: true });
  });

  it("loads a registry index from a local path", async () => {
    const indexPath = path.join(dir, "index.json");
    writeFileSync(indexPath, JSON.stringify({
      version: 1,
      skills: [{ name: "deploy-checks", description: "Pre-deploy verification steps. Use when shipping.", repo: "someone/deploy-checks" }],
    }));
    const index = await loadRegistryIndex(indexPath);
    expect(index.skills[0].name).toBe("deploy-checks");
    expect(index.version).toBe(1);
  });

  it("searchSkills merges bundled + registry entries", async () => {
    // bundled hit: tdd-laravel matches "test"
    const indexPath = path.join(dir, "index.json");
    writeFileSync(indexPath, JSON.stringify({
      version: 1,
      skills: [{ name: "deploy-checks", description: "Pre-deploy verification steps. Use when shipping to production.", repo: "someone/deploy-checks" }],
    }));
    writeFileSync(path.join(dir, "agent.config.yaml"), `project: { name: reg, description: "" }\nskillRegistry: ${indexPath}\n`);

    const hits = await searchSkills("deploy", dir);
    expect(hits.some((h) => h.name === "deploy-checks" && h.origin === "registry")).toBe(true);

    const bundled = await searchSkills("laravel", dir);
    expect(bundled.some((h) => h.origin === "bundled")).toBe(true);

    const none = await searchSkills("zzz-no-match", dir);
    expect(none).toEqual([]);
  });
});
