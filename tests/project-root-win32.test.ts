import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectRoot } from "../src/core/project.js";

describe.skipIf(process.platform !== "win32")("projectRoot on Windows", () => {
  let dir = "";
  const project = process.env.AGENTOS_PROJECT;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (project === undefined) delete process.env.AGENTOS_PROJECT;
    else process.env.AGENTOS_PROJECT = project;
  });

  it("excludes the home marker when its casing differs", () => {
    delete process.env.AGENTOS_PROJECT;
    dir = mkdtempSync(path.join(tmpdir(), "agentos-home-case-"));
    const from = path.join(dir, "code");
    mkdirSync(path.join(dir, ".agentos"));
    mkdirSync(from);

    expect(projectRoot(from, dir.toLowerCase())).toBe(path.resolve(from));
  });
});
