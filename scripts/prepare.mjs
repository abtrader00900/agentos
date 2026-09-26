#!/usr/bin/env node
// Build dist/ for `npm install` in a checkout and for `npm install -g github:…`.
//
// The git case is the tricky one: npm prepares a git dependency by cloning it
// and running a nested `npm install --include=dev`, but its own --global /
// --prefix config leaks into that step through npm_config_* env vars, so the
// nested install behaves like a global install and devDependencies (tsc) never
// land in the clone. When tsc is missing, fetch the compiler into a scratch
// prefix with that config stripped, and build with it.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tsc)) {
  const scratch = path.join(root, ".prepare");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });

  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^npm_config_(global|prefix|location|include|omit)$/i.test(k)) delete env[k];
  }
  const npmArgs = [
    "install", "--global=false", "--location=project", `--prefix=${scratch}`,
    "--no-save", "--no-package-lock", "--ignore-scripts", "--no-audit", "--no-fund",
    "typescript@5",
  ];
  // npm_execpath is npm's own cli.js (set for lifecycle scripts): running it through node
  // sidesteps the npm.cmd-needs-a-shell problem on Windows and any quoting of paths with spaces.
  const npmCli = process.env.npm_execpath;
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, ...npmArgs], { stdio: "inherit", env })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  tsc = path.join(scratch, "node_modules", "typescript", "bin", "tsc");
}

const build = spawnSync(process.execPath, [tsc, "-p", path.join(root, "tsconfig.json")], { stdio: "inherit", cwd: root });
process.exit(build.status ?? 1);
