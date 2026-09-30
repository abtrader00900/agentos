import { describe, it, expect } from "vitest";
import { runScheduled } from "../../src/orchestrator/scheduler.js";
import type { Plan } from "../../src/orchestrator/types.js";

const plan = (subs: Array<[string, string[]]>): Plan => ({
  summary: "s",
  subtasks: subs.map(([id, dependsOn]) => ({ id, title: id, prompt: id, files: [], dependsOn, agent: "claude" })),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("scheduler", () => {
  it("runs dependencies first", async () => {
    const order: string[] = [];
    await runScheduled(plan([["b", ["a"]], ["a", []]]), new Set(), async (s) => { order.push(s.id); await sleep(10); return true; }, { maxWorkers: 2 });
    expect(order).toEqual(["a", "b"]);
  });

  it("runs up to maxWorkers at once and never more", async () => {
    let now = 0;
    let peak = 0;
    const t0 = Date.now();
    await runScheduled(plan([["a", []], ["b", []], ["c", []]]), new Set(), async () => {
      now++; peak = Math.max(peak, now); await sleep(200); now--; return true;
    }, { maxWorkers: 2 });
    expect(peak).toBe(2);
    expect(Date.now() - t0).toBeLessThan(550); // two waves of 200 ms, not three
  });

  it("skips subtasks that are already done (resume)", async () => {
    const ran: string[] = [];
    const done = new Set(["a"]);
    await runScheduled(plan([["a", []], ["b", ["a"]]]), done, async (s) => { ran.push(s.id); return true; }, { maxWorkers: 2 });
    expect(ran).toEqual(["b"]);
    expect([...done]).toEqual(["a", "b"]);
  });

  it("starts nothing new after a failure, and never runs its dependents", async () => {
    const ran: string[] = [];
    const r = await runScheduled(plan([["a", []], ["b", ["a"]], ["c", []]]), new Set(), async (s) => { ran.push(s.id); return s.id !== "a"; }, { maxWorkers: 1 });
    expect(r.failed).toEqual(["a"]);
    expect(ran).toEqual(["a"]);
  });

  it("counts a thrown error as a failure", async () => {
    const r = await runScheduled(plan([["a", []]]), new Set(), async () => { throw new Error("x"); }, { maxWorkers: 1 });
    expect(r.failed).toEqual(["a"]);
  });

  it("waits for free memory before a second worker, but always runs one", async () => {
    let free = false;
    let now = 0;
    let peak = 0;
    setTimeout(() => (free = true), 300);
    await runScheduled(plan([["a", []], ["b", []]]), new Set(), async () => {
      now++; peak = Math.max(peak, now); await sleep(600); now--; return true;
    }, { maxWorkers: 2, canStart: () => free, waitMs: 50 });
    expect(peak).toBe(2); // b started once memory freed, while a still ran

    now = 0; peak = 0;
    await runScheduled(plan([["a", []], ["b", []]]), new Set(), async () => {
      now++; peak = Math.max(peak, now); await sleep(50); now--; return true;
    }, { maxWorkers: 2, canStart: () => false, waitMs: 20 });
    expect(peak).toBe(1);
  });
});
