import { describe, it, expect } from "vitest";
import { cronError, dueSchedules, scheduleKey } from "../../src/daemon/schedule.js";

const nightly = { cron: "0 2 * * *", task: "nightly chores", quick: false };
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

describe("schedules", () => {
  it("does not fire retroactively the first time it sees a schedule", () => {
    const r = dueSchedules("p", [nightly], {}, at(1, 12));
    expect(r.due).toEqual([]);
    expect(r.seen[scheduleKey("p", nightly)]).toBe(at(1, 12).toISOString());
  });

  it("fires once when its time has passed since it last fired, even after missing several", () => {
    const key = scheduleKey("p", nightly);
    const r = dueSchedules("p", [nightly], { [key]: at(1, 12).toISOString() }, at(4, 9)); // 2, 3 and 4 Oct at 02:00 all passed
    expect(r.due).toHaveLength(1);
    expect(r.due[0]).toMatchObject({ key, task: "nightly chores", quick: false });
    expect(r.due[0].firedFor.getTime()).toBe(at(2, 2).getTime());
    expect(r.seen[key]).toBe(at(4, 9).toISOString());
    expect(dueSchedules("p", [nightly], r.seen, at(4, 10)).due).toEqual([]);
  });

  it("reports a bad cron and keeps the other schedules", () => {
    const bad = { cron: "every night", task: "x x x", quick: false };
    const r = dueSchedules("p", [bad, nightly], {}, at(1, 12));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("every night");
    expect(Object.keys(r.seen)).toEqual([scheduleKey("p", nightly)]);
    expect(cronError("0 2 * * *")).toBeUndefined();
    expect(cronError("61 2 * * *")).toBeTruthy();
  });

  it("keys a schedule by project, cron and task", () => {
    expect(scheduleKey("p", nightly)).not.toBe(scheduleKey("q", nightly));
    expect(scheduleKey("p", nightly)).not.toBe(scheduleKey("p", { ...nightly, task: "other" }));
  });
});
