import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeRepo } from "../orchestrator/helpers.js";
import { startRun, type EngineDeps } from "../../src/orchestrator/engine.js";
import { runDir } from "../../src/orchestrator/run.js";
import { orchestratorSchema } from "../../src/core/schema.js";
import type { Runner, RunnerResult } from "../../src/orchestrator/types.js";

let repo: ReturnType<typeof makeRepo>;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

const reply = (text = "done"): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const cfg = (over: Record<string, unknown> = {}) => orchestratorSchema.parse({ link: [], ...over });
const planOf = (...ids: string[]) => ({ summary: "p", subtasks: ids.map((id) => ({ id, title: id, prompt: `create ${id}.txt`, files: [`${id}.txt`], dependsOn: [], agent: "claude" })) });
const events = (id: string) => readFileSync(path.join(runDir(repo.root, id), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const gh = vi.fn((_c: string, a: string[]) => (a[0] === "pr" ? "https://x/pull/1\n" : ""));
const creates = (cwd: string, p: string) => { const m = /create (\S+\.txt)/.exec(p); if (m) writeFileSync(path.join(cwd, m[1]), m[1]); };

function deps(read: Runner, claudeWrite: Runner, codexWrite: Runner = claudeWrite): EngineDeps {
  return { runners: { claude: { read, write: claudeWrite }, codex: { read, write: codexWrite } }, gh, freeMemMb: () => 1e6 };
}
const planner = (plan: object): Runner => async (req) => (req.prompt.includes("You are the planner") ? reply(JSON.stringify(plan)) : reply("[]"));

describe("run events for learning", { timeout: 60_000 }, () => {
  it("records a failing verify's output and the files a fix round changed", async () => {
    const verify = [`node -e "process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)"`];
    const write: Runner = async (req) => {
      if (req.prompt.includes("does not pass yet")) writeFileSync(path.join(req.cwd, "fixed.txt"), "ok");
      else creates(req.cwd, req.prompt);
      return reply();
    };
    await startRun(repo.root, "t", cfg({ verify }), deps(planner(planOf("a")), write), "ev1");
    const ev = events("ev1");
    const failed = ev.find((e) => e.type === "verify" && e.ok === false);
    expect(failed.output).toContain("FAILED");
    expect(failed.command).toContain("node -e");
    expect(ev.find((e) => e.type === "fix")).toMatchObject({ round: 1, files: ["fixed.txt"] });
    expect(ev.filter((e) => e.type === "verify" && e.ok).every((e) => e.output === undefined)).toBe(true);
  });

  it("records the error line of a CLI that fell back", async () => {
    const failing: Runner = async () => ({ ok: false, output: "starting\nError: model not supported\n", rateLimited: false, timedOut: false });
    const ok: Runner = async (req) => { creates(req.cwd, req.prompt); return reply(); };
    await startRun(repo.root, "t", cfg(), deps(planner(planOf("a")), failing, ok), "ev2");
    expect(events("ev2").find((e) => e.type === "fallback")).toMatchObject({ from: "claude", to: "codex", error: "Error: model not supported" });
  });

  it("records a resolved merge conflict", async () => {
    const write: Runner = async (req) => {
      if (req.prompt.includes("stopped with conflicts")) writeFileSync(path.join(req.cwd, "shared.txt"), "a and b\n");
      else writeFileSync(path.join(req.cwd, "shared.txt"), `${req.prompt.includes("create a.txt") ? "a" : "b"}\n`);
      return reply();
    };
    await startRun(repo.root, "t", cfg(), deps(planner(planOf("a", "b")), write), "ev3");
    expect(events("ev3").find((e) => e.type === "conflict-resolved")).toMatchObject({ files: ["shared.txt"] });
  });

  it("records a planner retry", async () => {
    const replies = [reply("not json"), reply(JSON.stringify(planOf("a")))];
    const read: Runner = async (req) => (req.prompt.includes("You are the planner") ? replies.shift()! : reply("[]"));
    const write: Runner = async (req) => { creates(req.cwd, req.prompt); return reply(); };
    await startRun(repo.root, "t", cfg(), deps(read, write), "ev4");
    expect(events("ev4").find((e) => e.type === "planner-retry").error).toContain("no JSON object");
  });

  it("redacts secrets from the planner-retry and fallback events", async () => {
    const secret = "s3cr3t-value-123456";
    process.env.AGENTOS_TEST_TOKEN = secret;
    try {
      const boom = { ok: false, output: `boom ${secret}`, rateLimited: false, timedOut: false } as RunnerResult; // fails on both CLIs, so attempt 1 is the planner's retry
      const planReplies = [boom, boom, reply(JSON.stringify(planOf("a")))];
      const read: Runner = async (req) => (req.prompt.includes("You are the planner") ? planReplies.shift()! : reply("[]"));
      const failing: Runner = async () => ({ ok: false, output: `Error: bad key ${secret}\n`, rateLimited: false, timedOut: false });
      const ok: Runner = async (req) => { creates(req.cwd, req.prompt); return reply(); };
      await startRun(repo.root, "t", cfg(), deps(read, failing, ok), "ev5");
      const ev = events("ev5");
      const retry = ev.find((e) => e.type === "planner-retry");
      const fb = ev.find((e) => e.type === "fallback");
      expect(retry.error).toContain("***");
      expect(fb.error).toContain("***");
      expect(JSON.stringify([retry, fb])).not.toContain(secret);
    } finally {
      delete process.env.AGENTOS_TEST_TOKEN;
    }
  });
});
