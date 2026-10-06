import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeRepo } from "../orchestrator/helpers.js";
import { preflight } from "../../src/commands/run.js";

const WIN = process.platform === "win32";
const CONFIG = "project: { name: p }\norchestrator:\n  planner: gemini\n  workers: [gemini]\n  reviewer: gemini\n  link: []\n";
const saved = { PATH: process.env.PATH, LOCALAPPDATA: process.env.LOCALAPPDATA };
afterEach(() => Object.assign(process.env, saved));

/** the real PATH (git must still run) minus any directory that already holds an agy */
const pathWithoutAgy = () =>
  (saved.PATH ?? "").split(path.delimiter).filter((d) => !["agy", "agy.exe", "agy.cmd"].some((n) => existsSync(path.join(d, n)))).join(path.delimiter);

/** an executable named `name` in a fresh directory */
function fakeBin(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agentos-bin-"));
  const file = path.join(dir, WIN ? `${name}.cmd` : name);
  writeFileSync(file, WIN ? "@echo off\r\n" : "#!/bin/sh\n");
  if (!WIN) chmodSync(file, 0o755);
  return dir;
}

describe("run preflight: the gemini agent runs Google's agy CLI", () => {
  it("accepts gemini when agy is on PATH, and names agy when it is missing", () => {
    const repo = makeRepo({ "agent.config.yaml": CONFIG });
    try {
      const empty = mkdtempSync(path.join(tmpdir(), "agentos-empty-"));
      process.env.PATH = pathWithoutAgy();
      process.env.LOCALAPPDATA = empty;
      expect(() => preflight(repo.root, () => "")).toThrow(/gemini \(agy\)/);
      process.env.PATH = [fakeBin("agy"), pathWithoutAgy()].join(path.delimiter);
      expect(preflight(repo.root, () => "").workers).toEqual(["gemini"]);
    } finally {
      repo.cleanup();
    }
  });

  it.runIf(WIN)("finds agy in %LOCALAPPDATA%\\agy\\bin when an older process has no PATH entry for it", () => {
    const repo = makeRepo({ "agent.config.yaml": CONFIG });
    try {
      const local = mkdtempSync(path.join(tmpdir(), "agentos-local-"));
      mkdirSync(path.join(local, "agy", "bin"), { recursive: true });
      writeFileSync(path.join(local, "agy", "bin", "agy.exe"), "");
      process.env.PATH = pathWithoutAgy();
      process.env.LOCALAPPDATA = local;
      expect(preflight(repo.root, () => "").planner).toBe("gemini");
    } finally {
      repo.cleanup();
    }
  });
});
