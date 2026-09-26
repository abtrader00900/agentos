#!/usr/bin/env node
// Build dist/ for `npm install` in a checkout and for `npm install -g github:…`.
//
// The git case is the tricky one: npm prepares a git dependency by cloning it
// and running a nested `npm install --include=dev`, but its own --global /
// --prefix config leaks into that step through npm_config_* env vars, so the
// nested install behaves like a global install of the clone itself and nothing
// lands in its node_modules — no tsc, no @types/node, no zod. When the compiler
// is missing, install the dependencies here with that config stripped, then build.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tsc)) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^npm_config_(global|prefix|location|include|omit)$/i.test(k)) delete env[k];
  }
  // --ignore-scripts keeps this install from running prepare (this script) again
  const npmArgs = ["ci", "--include=dev", "--ignore-scripts", "--global=false", "--location=project", "--no-audit", "--no-fund"];
  // npm_execpath is npm's own cli.js (set for lifecycle scripts): running it through node
  // sidesteps the npm.cmd-needs-a-shell problem on Windows and any quoting of paths with spaces.
  const npmCli = process.env.npm_execpath;
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, ...npmArgs], { stdio: "inherit", env, cwd: root })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, { stdio: "inherit", env, cwd: root, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const build = spawnSync(process.execPath, [tsc, "-p", path.join(root, "tsconfig.json")], { stdio: "inherit", cwd: root });
process.exit(build.status ?? 1);
