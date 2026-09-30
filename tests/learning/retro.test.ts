import { describe, it, expect } from "vitest";
import { retrospective, retroPrompt, type RetroInput } from "../../src/learning/retro.js";
import type { RunnerResult } from "../../src/orchestrator/types.js";

const reply = (text: string): RunnerResult => ({ ok: true, output: JSON.stringify({ type: "result", result: text }) + "\n", rateLimited: false, timedOut: false });
const input: RetroInput = {
  task: "add profit report", planSummary: "one subtask", status: "pr_open",
  evidence: [{ id: "E1", type: "verify_fixed", command: "php artisan test", failedTail: "missing column", files: ["database/migrations/x.php"], round: 1 }],
  existing: [{ key: "L-00000001", text: "Eager load relations", meta: { status: "auto", roles: ["worker"], evidence: [], runs: ["r0"], seen: 1, uses: 0 } }],
};

describe("retrospective", () => {
  it("keeps only cited evidence ids that exist, as descriptions", async () => {
    const r = await retrospective(async () => reply(JSON.stringify({ kind: "erp-report", lessons: [{ text: "Plan a migration whenever a report reads a new column", roles: ["planner"], evidence: ["E1", "E9"] }] })), input, ".", 1000);
    expect(r.result?.kind).toBe("erp-report");
    expect(r.result?.lessons[0].evidence).toHaveLength(1);
    expect(r.result?.lessons[0].evidence[0]).toMatch(/^E1: verify_fixed/);
  });

  it("forces lessons to [] when the run has no evidence", async () => {
    const r = await retrospective(async () => reply(JSON.stringify({ kind: "bug-fix", lessons: [{ text: "Invented lesson without any basis at all", roles: ["worker"], evidence: [] }] })), { ...input, evidence: [] }, ".", 1000);
    expect(r.result).toEqual({ kind: "bug-fix", lessons: [] });
  });

  it("retries once with the validation error, then gives up", async () => {
    const prompts: string[] = [];
    const replies = [reply('{"kind":"Bad Kind!","lessons":[]}'), reply('{"kind":"ok-kind","lessons":[]}')];
    const r = await retrospective(async (req) => { prompts.push(req.prompt); return replies.shift()!; }, input, ".", 1000);
    expect(r.result?.kind).toBe("ok-kind");
    expect(prompts[1]).toContain("previous reply was rejected");
    expect((await retrospective(async () => reply("no json"), input, ".", 1000)).error).toBeDefined();
  });

  it("reports a rate limit", async () => {
    expect(await retrospective(async () => ({ ok: false, output: "429", rateLimited: true, timedOut: false }), input, ".", 1000)).toEqual({ rateLimited: true });
  });

  it("the prompt carries task, evidence and existing lessons, and forbids URLs and commands", () => {
    const p = retroPrompt(input);
    for (const s of ["add profit report", "E1: verify_fixed", "L-00000001: Eager load relations", "Never put URLs"]) expect(p).toContain(s);
    expect(retroPrompt({ ...input, evidence: [] })).toContain("`lessons` must be []");
  });
});
