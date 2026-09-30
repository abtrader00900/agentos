import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryStore } from "../../src/mcp/memory/store.js";
import { lessonsFor } from "../../src/learning/inject.js";
import { saveLessons, listLessons, approveLesson, forgetLesson, lessonKey } from "../../src/learning/lessons.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "agentos-atomic-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

const EV = ["E1: verify_fixed: `npm test` failed"];
const TEXT = "Run the migration before the seed step";
const file = () => path.join(root, ".agentos", "memory.json");

/** Run `other` once, right after the next read of the store: between a read-modify-write's snapshot and its write. */
function afterNextRead(other: () => void): void {
  const recall = MemoryStore.prototype.recall;
  let fired = false;
  vi.spyOn(MemoryStore.prototype, "recall").mockImplementation(function (this: MemoryStore, q) {
    const r = recall.call(this, q);
    if (!fired) { fired = true; other(); }
    return r;
  });
}

describe("MemoryStore.patch", () => {
  it("applies fn to the current fact under the lock, re-keys in one write, and skips a missing fact", () => {
    const s = new MemoryStore(file());
    s.store({ topic: "t", key: "a", value: "v", source: "src", pinned: true, meta: { n: 1 } });
    // another instance changes the fact after s last read it: patch must see that change
    new MemoryStore(file()).store({ topic: "t", key: "a", value: "v", meta: { n: 5 } });
    expect(s.patch("t", "a", (f) => ({ meta: { n: (f.meta!.n as number) + 1 } }))?.meta).toEqual({ n: 6 });
    const moved = s.patch("t", "a", () => ({ key: "b", meta: { n: 7 } }));
    expect(moved).toMatchObject({ key: "b", value: "v", source: "src", pinned: 1, meta: { n: 7 } });
    expect(s.get("t", "a")).toBeUndefined();
    expect(s.patch("t", "a", () => ({ meta: {} }))).toBeUndefined();
    expect(s.get("t", "a")).toBeUndefined(); // skipped: not re-created
  });
});

describe("lesson meta updates are atomic", () => {
  it("a uses bump never resurrects a lesson forgotten meanwhile", () => {
    const [key] = saveLessons(root, "r1", undefined, [{ text: TEXT, roles: ["worker"], evidence: EV }]);
    afterNextRead(() => forgetLesson(root, key));
    lessonsFor(root, "worker", "run the migration", 5);
    vi.restoreAllMocks();
    expect(listLessons(root)).toEqual([]);
  });

  it("a merge never resurrects a lesson forgotten meanwhile", () => {
    const [key] = saveLessons(root, "r1", undefined, [{ text: TEXT, roles: ["worker"], evidence: EV }]);
    afterNextRead(() => forgetLesson(root, key));
    saveLessons(root, "r2", undefined, [{ text: "Another way to say the same seed lesson", roles: ["worker"], evidence: EV, sameAs: key }]);
    vi.restoreAllMocks();
    expect(listLessons(root).map((l) => l.key)).not.toContain(key);
  });

  it("an approval is not undone by a concurrent uses bump", () => {
    const [key] = saveLessons(root, "r1", undefined, [{ text: TEXT, roles: ["worker"], evidence: EV }]);
    afterNextRead(() => approveLesson(root, key));
    lessonsFor(root, "worker", "run the migration", 5);
    vi.restoreAllMocks();
    expect(listLessons(root)[0].meta).toMatchObject({ status: "approved", uses: 1 });
  });

  it("an approval is not undone by a concurrent merge", () => {
    const [key] = saveLessons(root, "r1", undefined, [{ text: TEXT, roles: ["worker"], evidence: [] }]);
    afterNextRead(() => approveLesson(root, key));
    saveLessons(root, "r2", undefined, [{ text: "Another way to say the same seed lesson", roles: ["worker"], evidence: EV, sameAs: key }]);
    vi.restoreAllMocks();
    const [l] = listLessons(root);
    expect(l.meta).toMatchObject({ status: "approved", runs: ["r1", "r2"], seen: 2 });
  });

  it("a merge keeps the runs and evidence another writer added meanwhile", () => {
    const [key] = saveLessons(root, "r1", undefined, [{ text: TEXT, roles: ["worker"], evidence: EV }]);
    afterNextRead(() => saveLessons(root, "r2", undefined, [{ text: "Second phrasing of the seed lesson", roles: ["worker"], evidence: ["E2: other"], sameAs: key }]));
    saveLessons(root, "r3", undefined, [{ text: "Third phrasing of the seed lesson", roles: ["worker"], evidence: ["E3: third"], sameAs: key }]);
    vi.restoreAllMocks();
    const [l] = listLessons(root);
    expect(l.meta.runs).toEqual(["r1", "r2", "r3"]);
    expect(l.meta.seen).toBe(3);
    expect(l.meta.evidence).toEqual([...EV, "E2: other", "E3: third"]);
  });

  it("approve keeps a run merged meanwhile", () => {
    const [key] = saveLessons(root, "r1", undefined, [{ text: TEXT, roles: ["worker"], evidence: [] }]);
    afterNextRead(() => saveLessons(root, "r2", undefined, [{ text: "Second phrasing of the seed lesson", roles: ["worker"], evidence: [], sameAs: key }]));
    approveLesson(root, key);
    vi.restoreAllMocks();
    expect(listLessons(root)[0].meta).toMatchObject({ status: "approved", runs: ["r1", "r2"], seen: 2 });
  });

  it("approving (and re-keying) a lesson forgotten meanwhile fails instead of resurrecting it", () => {
    const [key] = saveLessons(root, "r1", undefined, [{ text: TEXT, roles: ["worker"], evidence: [] }]);
    new MemoryStore(file()).store({ topic: "lessons", key, value: "A swapped text under the old key" });
    afterNextRead(() => forgetLesson(root, key));
    expect(() => approveLesson(root, key)).toThrow(`No lesson "${key}"`);
    vi.restoreAllMocks();
    expect(listLessons(root)).toEqual([]);
    expect(new MemoryStore(file()).get("lessons", lessonKey("A swapped text under the old key"))).toBeUndefined();
  });
});
