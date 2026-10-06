// tests/ui/frontend.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { startTestServer, req } from "./helpers.js";

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ui");
const read = (f: string) => readFileSync(path.join(uiDir, f), "utf8");
let t: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

describe("frontend", () => {
  it("never builds HTML from strings", () => {
    const app = read("app.js");
    for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) expect(app).not.toContain(bad);
  });

  it("has no inline script or style in index.html (CSP)", () => {
    const html = read("index.html");
    expect(html).toMatch(/<script src="labels\.js"><\/script>/);
    expect(html).toMatch(/<script src="app\.js"><\/script>/);
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(html).not.toMatch(/\sstyle=|<style/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("every label the app uses exists in labels.js", () => {
    const ctx: { window: { LABELS?: Record<string, string> } } = { window: {} };
    vm.runInNewContext(read("labels.js"), ctx);
    const labels = ctx.window.LABELS!;
    const used = [...read("app.js").matchAll(/\bL\("([a-zA-Z0-9_.]+)"\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((k) => !(k in labels))).toEqual([]);
  });

  it("part 2 screens exist and use labels", () => {
    const app = read("app.js");
    for (const route of ["#/p/", "/lessons", "/drafts", "/new"]) expect(app).toContain(route);
    for (const k of ["approve", "forget", "promote", "reject", "startRun", "heldBySafety", "confirmForget"]) expect(app).toContain(`L("${k}")`);
  });

  it("offers quick runs and only sends the true flag", () => {
    const ctx: { window: { LABELS?: Record<string, string> } } = { window: {} };
    vm.runInNewContext(read("labels.js"), ctx);
    const app = read("app.js");
    expect(app).toContain('L("new.quick")');
    expect(ctx.window.LABELS!["new.quick"]).toBeTruthy();
    expect(app).toContain("quick.checked ? { quick: true } : {}");
  });

  it("says a run is starting while it waits out the 404", () => {
    const ctx: { window: { LABELS?: Record<string, string> } } = { window: {} };
    vm.runInNewContext(read("labels.js"), ctx);
    expect(read("app.js")).toContain('L("run.starting")');
    expect(ctx.window.LABELS!["run.starting"]).toBeTruthy();
  });

  it("has a Queue page and a daemon status line", () => {
    const ctx: { window: { LABELS?: Record<string, string> } } = { window: {} };
    vm.runInNewContext(read("labels.js"), ctx);
    const app = read("app.js");
    for (const k of ["nav.queue", "queue.title", "queue.add", "queue.remove", "queue.empty", "daemon.running", "daemon.stopped"]) {
      expect(ctx.window.LABELS![k], k).toBeTruthy();
      expect(app).toContain(`L("${k}")`);
    }
    expect(app).toContain('"/api/queue"');
    expect(app).toContain('"/api/daemon"');
    expect(app).not.toMatch(/innerHTML/);
  });

  it("sums up the router events on one line each", () => {
    const ctx: { window: { LABELS?: Record<string, string> } } = { window: {} };
    vm.runInNewContext(read("labels.js"), ctx);
    const app = read("app.js");
    expect(app).toMatch(/case "fallback": return name \+ ": " \+ e\.from \+ " → " \+ e\.to \+ " \(" \+ \(e\.why \|\| ""\) \+ "\)";/);
    expect(app).toContain('case "read-guard":');
    expect(app).toContain('L("events.changed")');
    for (const k of ["ev.fallback", "ev.read-guard", "events.changed"]) expect(ctx.window.LABELS![k], k).toBeTruthy();
    expect(app).not.toMatch(/innerHTML/);
  });

  it("serves the app files with the right types", async () => {
    t = await startTestServer();
    for (const [f, type] of [["/", /text\/html/], ["/app.js", /javascript/], ["/labels.js", /javascript/], ["/style.css", /text\/css/]] as const) {
      const r = await req(t.port, { path: f });
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toMatch(type);
    }
  });
});
