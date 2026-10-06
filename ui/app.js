/**
 * The dashboard, as plain JS: no build step, no dependencies, no modules.
 *
 * It renders into the shell index.html provides (#sidebar, #main, #banner,
 * #menu) and talks to the API with the session cookie. Under the server's CSP
 * nothing may be parsed as code or markup, so every node here is built with
 * h() and every string lands as text — see h() for the one place that touches
 * the DOM.
 */
(function () {
  "use strict";

  const L = (k) => window.LABELS[k] ?? k;

  // ---------------------------------------------------------------- DOM

  /** The only props h() honours. Anything else is a typo and is dropped, so no key can ever become markup. */
  const PROPS = { className: 1, href: 1, title: 1, type: 1, id: 1, rel: 1, target: 1, colSpan: 1 };
  const BOOL = { disabled: 1, hidden: 1, checked: 1 };
  const ON = { onclick: 1, onchange: 1 };

  function h(tag, props) {
    const el = document.createElement(tag);
    for (const k in props) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (ON[k]) el[k] = v;
      else if (BOOL[k]) el[k] = true;
      else if (PROPS[k]) el[k] = v;
    }
    add(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }

  /** Children: nodes are appended, arrays flattened, nullish/false skipped, everything else becomes text. */
  function add(el, children) {
    for (const c of children) {
      if (c === null || c === undefined || c === false || c === true) continue;
      if (Array.isArray(c)) add(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }

  const clear = (el) => { el.textContent = ""; };
  const text = (tag, className, s) => h(tag, { className: className }, s);

  function section(title) {
    return h("section", { className: "section" }, h("h2", null, title), Array.prototype.slice.call(arguments, 1));
  }

  // -------------------------------------------------------------- server

  function banner(message) {
    const el = document.getElementById("banner");
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }

  /**
   * What `api(path, { allow404: true })` resolves to instead of bannering a
   * 404. Only identity matters: a caller waiting for something the server does
   * not have yet can tell "not there" from "went wrong" without reading status
   * codes, and every other failure still comes back as null.
   */
  const NOT_FOUND = {};

  /**
   * One fetch wrapper for the whole app. It resolves to the parsed body, or to
   * null after putting the server's `{ error }` in the banner — callers bail
   * on null and leave whatever is already on screen alone.
   */
  async function api(path, opts) {
    const o = opts || {};
    const method = o.method || "GET";
    const init = { method: method, credentials: "same-origin" };
    if (method === "POST" || method === "DELETE") {
      // the server refuses a state change without both of these
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(o.body ?? {});
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      banner(L("err.network"));
      return null;
    }
    let body = null;
    try {
      body = await res.json();
    } catch (e) { /* an empty or non-JSON body is still a usable status */ }
    if (!res.ok) {
      if (res.status === 404 && o.allow404) return NOT_FOUND;
      banner((body && body.error) || L("err.generic"));
      return null;
    }
    banner(null);
    return body === null ? {} : body;
  }

  const projectApi = (p) => "/api/p/" + encodeURIComponent(p);
  const runApi = (p, id) => projectApi(p) + "/runs/" + encodeURIComponent(id);
  const runHref = (p, id) => "#/p/" + encodeURIComponent(p) + "/runs/" + encodeURIComponent(id);

  // ------------------------------------------------------------ formatting

  const money = (n) => "$" + (Number(n) || 0).toFixed(2);
  /** Agent and verify output is coloured for a terminal; the escapes are noise here. */
  const plain = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, "");
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const count = (a) => (Array.isArray(a) ? a.length : 0);

  /** An event's ISO timestamp as local HH:MM:SS. */
  function clock(ts) {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function duration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + L("time.s");
    const m = Math.floor(s / 60);
    if (m < 60) return m + L("time.m") + " " + (s % 60) + L("time.s");
    return Math.floor(m / 60) + L("time.h") + " " + (m % 60) + L("time.m");
  }

  function ago(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return "";
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return L("time.now");
    if (s < 3600) return Math.floor(s / 60) + L("time.m") + " " + L("time.ago");
    if (s < 86400) return Math.floor(s / 3600) + L("time.h") + " " + L("time.ago");
    return Math.floor(s / 86400) + L("time.d") + " " + L("time.ago");
  }

  /** A live run is still ticking; a finished one stopped when it was last saved. */
  function elapsed(run) {
    const start = Date.parse(run.createdAt);
    const end = run.active ? Date.now() : Date.parse(run.updatedAt);
    if (!isFinite(start) || !isFinite(end)) return "";
    return duration(Math.max(0, end - start));
  }

  const ACTIVE = ["queued", "planning", "working", "verifying", "fixing"];
  const NEEDS_YOU = ["needs_human", "failed"];

  const statusSpan = (status) =>
    h("span", { className: "status s-" + status }, h("span", { className: "ico" }, L("icon." + status)), L("status." + status));

  const meta = (label, value) => h("span", { className: "m" }, h("span", { className: "m-k" }, label), h("span", { className: "m-v" }, value));

  // ------------------------------------------------------------- sidebar

  function renderSidebar(projects, r, daemon) {
    const el = document.getElementById("sidebar");
    clear(el);
    el.appendChild(h("a", { className: "brand", href: "#/" }, L("nav.brand")));
    el.appendChild(h("a", { className: r.screen === "home" ? "navlink sel" : "navlink", href: "#/" }, L("nav.projects")));
    el.appendChild(h("a", { className: r.screen === "queue" ? "navlink sel" : "navlink", href: "#/queue" }, L("nav.queue")));
    // only a status we actually read is shown: a later screen request clears this
    // one's banner, so claiming "stopped" for a daemon we could not ask about would
    // leave a false status on screen with nothing to explain it
    if (daemon) el.appendChild(text("p", "dstatus", daemon.running
      ? L("daemon.running") + " · " + daemon.today + "/" + daemon.maxRunsPerDay + " " + L("daemon.today")
      : L("daemon.stopped")));
    if (!projects.length) el.appendChild(text("p", "muted", L("nav.noProjects")));
    for (const p of projects) {
      const selected = p.id === r.p;
      el.appendChild(h("div", { className: selected ? "proj sel" : "proj" },
        h("a", { className: "proj-name", href: "#/p/" + encodeURIComponent(p.id) + "/runs", title: p.path }, p.name),
        p.running > 0 ? h("span", { className: "dot", title: L("home.running") }) : null,
        p.needsYou > 0 ? h("span", { className: "badge", title: L("home.needsYou") }, String(p.needsYou)) : null,
        p.missing ? text("span", "missing", L("nav.missing")) : null,
        p.missing ? h("button", { className: "btn danger", onclick: () => removeProject(p.id) }, L("nav.remove")) : null));
      if (selected) el.appendChild(projectNav(p, r));
    }
  }

  function projectNav(p, r) {
    const base = "#/p/" + encodeURIComponent(p.id);
    const items = [
      { key: "runs", href: base + "/runs", label: L("nav.runs") },
      { key: "lessons", href: base + "/lessons", label: L("nav.lessons"), n: p.pendingLessons },
      { key: "drafts", href: base + "/drafts", label: L("nav.drafts"), n: p.drafts },
      { key: "new", href: base + "/new", label: L("nav.new") },
    ];
    return h("div", { className: "nav" }, items.map((it) =>
      h("a", { className: it.key === r.screen ? "navlink sel" : "navlink", href: it.href },
        it.label,
        it.n > 0 ? h("span", { className: "count" }, String(it.n)) : null)));
  }

  async function removeProject(id) {
    if (!(await api("/api/projects/" + encodeURIComponent(id), { method: "DELETE" }))) return;
    if (route().p === id) location.hash = "#/";
    else render();
  }

  // --------------------------------------------------------- all projects

  async function renderHome(main, projects, seq) {
    clear(main);
    main.appendChild(h("h1", null, L("home.title")));
    main.appendChild(h("div", { className: "cards" }, projects.map(projectCard)));
    const box = h("section", { className: "needsyou" }, h("h2", null, L("home.needsYou")));
    main.appendChild(box);
    let any = false;
    for (const p of projects) {
      if (p.missing) continue;
      const base = "#/p/" + encodeURIComponent(p.id);
      const items = [];
      if (p.needsYou > 0) {
        const runs = await api(projectApi(p.id) + "/runs");
        if (stale(seq)) return;
        for (const r of (runs || []).filter((r) => NEEDS_YOU.indexOf(r.status) >= 0 || r.flagged)) {
          items.push(h("a", { className: "item", href: runHref(p.id, r.id) }, statusSpan(r.status), truncate(r.task || r.id, 90)));
        }
      }
      if (p.pendingLessons > 0) items.push(h("a", { className: "item", href: base + "/lessons" }, p.pendingLessons + " " + L("home.pendingLessons")));
      if (p.drafts > 0) items.push(h("a", { className: "item", href: base + "/drafts" }, p.drafts + " " + L("home.draftsWaiting")));
      if (!items.length) continue;
      any = true;
      box.appendChild(h("div", { className: "np" }, h("h3", null, p.name), items));
    }
    if (!any) box.appendChild(text("p", "muted", L("home.nothing")));
  }

  function projectCard(p) {
    const week = p.week || { runs: 0, prs: 0, costUsd: 0 };
    const stat = (label, value) => [h("dt", null, label), h("dd", null, String(value))];
    return h("div", { className: p.missing ? "card missing" : "card" },
      h("a", { className: "card-title", href: "#/p/" + encodeURIComponent(p.id) + "/runs", title: p.path }, p.name),
      p.missing ? text("span", "missing", L("nav.missing")) : null,
      p.missing ? h("button", { className: "btn danger", onclick: () => removeProject(p.id) }, L("nav.remove")) : null,
      h("dl", null,
        stat(L("home.running"), p.running),
        stat(L("home.needsYou"), p.needsYou),
        stat(L("home.lessons"), p.pendingLessons),
        stat(L("home.drafts"), p.drafts),
        stat(L("home.weekRuns"), week.runs),
        stat(L("home.weekPrs"), week.prs),
        stat(L("home.weekCost"), money(week.costUsd))));
  }

  // ---------------------------------------------------------------- runs

  async function renderRuns(main, p, seq) {
    clear(main);
    main.appendChild(text("p", "muted", L("common.loading")));
    await refreshRuns(main, p, seq, true);
  }

  async function refreshRuns(main, p, seq, first) {
    const rows = await api(projectApi(p) + "/runs");
    if (stale(seq)) return;
    if (!rows) { if (first) clear(main); return; }  // the banner says why; a failed refresh keeps the last table
    paintRuns(main, p, rows);
    const busy = rows.some((r) => ACTIVE.indexOf(r.status) >= 0);
    if (first && busy) timer = setInterval(() => refreshRuns(main, p, seq, false), 5000);
    if (!busy && timer) { clearInterval(timer); timer = null; }
  }

  function paintRuns(main, p, rows) {
    clear(main);
    main.appendChild(h("div", { className: "head" },
      h("h1", null, L("runs.title")),
      h("a", { className: "btn", href: "#/p/" + encodeURIComponent(p) + "/new" }, L("runs.new"))));
    if (!rows.length) { main.appendChild(text("p", "muted", L("runs.empty"))); return; }
    const head = h("tr", null, [L("runs.task"), L("runs.status"), L("runs.rounds"), L("runs.cost"), L("runs.age")].map((t) => h("th", null, t)));
    main.appendChild(h("table", { className: "runs" },
      h("thead", null, head),
      h("tbody", null, rows.map((r) => h("tr", null,
        h("td", null, h("a", { href: runHref(p, r.id), title: r.task || r.id }, truncate(r.task || r.id, 70))),
        h("td", { title: r.flagged ? L("runs.flaggedTitle") : null }, r.flagged ? L("runs.flagged") + " " : null, statusSpan(r.status)),
        h("td", null, r.fixRound ? String(r.fixRound) : ""),
        h("td", null, r.costUsd === undefined || r.costUsd === null ? "" : money(r.costUsd)),
        h("td", { title: r.createdAt || "" }, ago(r.createdAt)))))));
  }

  // ----------------------------------------------------------- run detail

  const STAGES = ["queued", "planning", "working", "verifying", "fixing", "pr", "learning"];
  const STAGE_OF = { queued: "queued", planning: "planning", working: "working", verifying: "verifying", fixing: "fixing", pr_open: "pr" };
  const MAX_EVENTS = 3000;
  const START_TRIES = 15;                        // one a second: preflight takes a few, so 15s covers a slow start

  async function renderRun(main, p, id, seq) {
    clear(main);
    main.appendChild(text("p", "muted", L("common.loading")));
    const run = await loadRun(main, p, id, seq);
    if (!run) return;                            // the route moved on, or loadRun gave up and said why

    const ctx = { p: p, id: id, run: run, events: [], showAgent: false, seq: seq };
    clear(main);
    ctx.summary = h("div", null);
    main.appendChild(ctx.summary);
    paintRun(ctx);
    if (run.active) timer = setInterval(() => { ctx.elapsedValue.textContent = elapsed(ctx.run); }, 1000);
    main.appendChild(diffSection(ctx));
    main.appendChild(eventsSection(ctx));
    openStream(ctx);
  }

  /**
   * `agentos run` is spawned detached and writes its state file only once
   * preflight is through, so the run a click just created is a 404 for the next
   * few seconds. That is "starting", not "no such run": ask again every second
   * while saying so, and let the last try banner the 404 like any other error.
   */
  function loadRun(main, p, id, seq) {
    return new Promise((resolve) => {
      let tries = 0;
      const attempt = async () => {
        // the try after the last one lets the 404 banner itself, like any other error
        const run = await api(runApi(p, id), { allow404: ++tries <= START_TRIES });
        if (stale(seq)) return resolve(null);
        if (run === NOT_FOUND) {
          clear(main);
          main.appendChild(text("p", "muted", L("run.starting")));
          starting = setTimeout(() => { starting = null; attempt(); }, 1000);
          return;
        }
        if (!run) clear(main);                   // the banner says why
        resolve(run);
      };
      attempt();
    });
  }

  function paintRun(ctx) {
    const run = ctx.run;
    clear(ctx.summary);
    ctx.summary.appendChild(runHeader(ctx));
    ctx.summary.appendChild(stageBar(run));
    ctx.summary.appendChild(subtasksSection(run));
    ctx.summary.appendChild(verifySection(ctx));
    const extra = [findingsSection(run), lessonsSection(run), planSection(run), prSection(run)];
    for (const s of extra) if (s) ctx.summary.appendChild(s);
  }

  async function refreshRun(ctx) {
    const run = await api(runApi(ctx.p, ctx.id));
    if (!run || stale(ctx.seq)) return;
    ctx.run = run;
    paintRun(ctx);
    if (run.active && ACTIVE.indexOf(run.status) < 0) {
      if (timer) clearInterval(timer);
      timer = setInterval(() => refreshRun(ctx), 1000);
    } else if (!run.active && timer) { clearInterval(timer); timer = null; }
  }

  function runHeader(ctx) {
    const run = ctx.run;
    const agents = runAgents(run);
    return h("div", { className: "header" },
      h("h1", null, run.task || run.id),
      h("div", { className: "meta" },
        statusSpan(run.status),
        run.reason ? text("span", "reason", run.reason) : null,
        run.fixRound ? meta(L("run.round"), String(run.fixRound)) : null,
        elapsedMeta(ctx),
        meta(L("run.cost"), money(run.usage && run.usage.costUsd)),
        agents.length ? meta(L("run.agents"), agents.join(", ")) : null,
        actionButton(ctx)));
  }

  function elapsedMeta(ctx) {
    ctx.elapsedValue = h("span", { className: "m-v" }, elapsed(ctx.run));
    return h("span", { className: "m" }, h("span", { className: "m-k" }, L("run.elapsed")), ctx.elapsedValue);
  }

  /** Who worked on the run: the subtasks name them, and usage catches the planner and reviewer too. */
  function runAgents(run) {
    const seen = [];
    for (const s of run.subtasks || []) if (s.agent && seen.indexOf(s.agent) < 0) seen.push(s.agent);
    for (const a in (run.usage && run.usage.byAgent) || {}) if (seen.indexOf(a) < 0) seen.push(a);
    return seen;
  }

  function actionButton(ctx) {
    const which = ctx.run.active ? "cancel" : ctx.run.canResume ? "resume" : null;
    if (!which) return null;
    const btn = h("button", { className: which === "cancel" ? "btn danger" : "btn" }, L("run." + which));
    btn.onclick = async () => {
      btn.disabled = true;                       // one click per request; a 409 comes back in the banner
      const ok = await api(runApi(ctx.p, ctx.id) + "/" + which, { method: "POST" });
      btn.disabled = false;
      if (ok) render();
    };
    return btn;
  }

  /** Where the bar stops. A run that ended off-stage is placed by the furthest thing it produced. */
  function currentStage(run) {
    if (run.learned) return "learning";
    if (STAGE_OF[run.status]) return STAGE_OF[run.status];
    if (run.prUrl) return "pr";
    if (STAGE_OF[run.resumeFrom]) return STAGE_OF[run.resumeFrom];
    if (run.verifyOk !== undefined) return "verifying";
    if ((run.subtasks || []).length) return "working";
    return run.plan ? "planning" : "queued";
  }

  function stageBar(run) {
    const at = STAGES.indexOf(currentStage(run));
    return h("div", { className: "stages" }, STAGES.map((s, i) =>
      h("span", { className: "stage" + (i < at ? " done" : i === at ? " now" : "") }, L("stage." + s))));
  }

  function subtasksSection(run) {
    const list = run.subtasks || [];
    if (!list.length) return section(L("run.subtasks"), text("p", "muted", L("run.noSubtasks")));
    return section(L("run.subtasks"), h("ul", { className: "subtasks" }, list.map((s) =>
      h("li", { className: "sub st-" + s.status },
        h("span", { className: "sub-id" }, s.id),
        h("span", { className: "sub-agent" }, s.agent),
        h("span", { className: "sub-status" }, L("sub." + s.status)),
        s.summary ? h("span", { className: "sub-summary" }, s.summary) : null))));
  }

  /**
   * The saved run knows whether verify passed; only the newest verify event
   * carries the command that failed, so the box is repainted when one arrives.
   */
  function verifySection(ctx) {
    ctx.verifyBox = h("div", null);
    paintVerify(ctx, ctx.verifyEvent || null);
    return section(L("run.verify"), ctx.verifyBox);
  }

  function paintVerify(ctx, ev) {
    const run = ctx.run;
    const box = ctx.verifyBox;
    clear(box);
    if (!ev && run.verifyOk === undefined) { box.appendChild(text("p", "muted", L("run.noVerify"))); return; }
    const ok = ev ? ev.ok : run.verifyOk;
    box.appendChild(text("p", ok ? "ok" : "bad", ok ? L("run.verifyOk") : L("run.verifyFailed")));
    if (ev && ev.command) box.appendChild(text("p", "cmd", L("run.command") + ": " + plain(ev.command)));
    const out = (ev && ev.output) || run.verifyOutput;
    if (out) box.appendChild(h("pre", null, plain(out)));
  }

  function findingsSection(run) {
    const list = run.findings || [];
    if (!list.length) return null;
    return section(L("run.findings"), h("ul", { className: "findings" }, list.map((f) =>
      h("li", { className: "finding sev-" + f.severity },
        h("span", { className: "sev" }, L("sev." + f.severity)),
        f.file ? h("span", { className: "loc" }, f.file + ":" + f.line) : null,
        h("span", { className: "issue" }, f.issue)))));
  }

  function lessonsSection(run) {
    const list = run.lessonsUsed || [];
    if (!list.length) return null;
    return section(L("run.lessonsUsed"), h("ul", { className: "lessons" }, list.map((l) => h("li", null, l))));
  }

  function planSection(run) {
    if (!run.plan || !run.plan.summary) return null;
    return section(L("run.plan"), h("p", null, run.plan.summary));
  }

  function prSection(run) {
    if (!run.prUrl) return null;
    return section(L("run.pr"), h("a", { href: run.prUrl, rel: "noreferrer", target: "_blank" }, run.prUrl));
  }

  function diffSection(ctx) {
    const body = h("div", null);
    const btn = h("button", { className: "btn" }, L("run.showDiff"));
    btn.onclick = async () => {
      btn.disabled = true;
      const d = await api(runApi(ctx.p, ctx.id) + "/diff");
      btn.disabled = false;
      if (!d) return;                            // a gone branch is a 404 and already shows in the banner
      clear(body);
      if (d.truncated) body.appendChild(text("p", "note", L("run.diffTruncated")));
      const pre = h("pre", { className: "diff" });
      pre.textContent = d.diff || "";
      body.appendChild(pre);
    };
    return section(L("run.diff"), btn, body);
  }

  // ---------------------------------------------------------- live events

  function eventsSection(ctx) {
    ctx.panel = h("div", { className: "events" });
    ctx.placeholder = text("p", "muted", L("run.noEvents"));
    const box = h("input", { type: "checkbox" });
    // agent lines already received must appear too, so the toggle repaints from the array
    box.onchange = () => { ctx.showAgent = box.checked; paintEvents(ctx); };
    return section(L("run.events"), h("label", { className: "toggle" }, box, L("run.showAgent")), ctx.placeholder, ctx.panel);
  }

  const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 24;

  function paintEvents(ctx) {
    const rows = ctx.showAgent ? ctx.events : ctx.events.filter((e) => e.type !== "agent");
    clear(ctx.panel);
    for (const e of rows) ctx.panel.appendChild(eventRow(e));
    ctx.placeholder.hidden = rows.length > 0;
    ctx.panel.scrollTop = ctx.panel.scrollHeight;
  }

  function pushEvent(ctx, e) {
    ctx.events.push(e);
    if (ctx.events.length > MAX_EVENTS) ctx.events.shift();   // a long run must not grow the page forever
    if (e.type === "agent" && !ctx.showAgent) return;
    const bottom = nearBottom(ctx.panel);
    ctx.placeholder.hidden = true;
    ctx.panel.appendChild(eventRow(e));
    while (ctx.panel.childElementCount > MAX_EVENTS) ctx.panel.removeChild(ctx.panel.firstChild);
    if (bottom) ctx.panel.scrollTop = ctx.panel.scrollHeight;
  }

  function eventRow(e) {
    const row = h("div", { className: "event" }, h("span", { className: "ev-time" }, clock(e.ts)));
    if (e.type === "agent") {
      add(row, [h("span", { className: "ev-agent" }, String(e.agent || "")), h("span", { className: "ev-text" }, " · " + plain(e.line || ""))]);
    } else {
      row.appendChild(h("span", { className: "ev-text" }, plain(summarise(e))));
    }
    return row;
  }

  /** One short line per event. An unknown type still says what it was and shows its first scalar field. */
  function summarise(e) {
    const name = L("ev." + e.type);
    switch (e.type) {
      case "start": return name + ": " + (e.task || "");
      case "resume": return name + ": " + L("status." + e.status);
      case "stale-lock": return name + ": " + e.pid;
      case "abort-stale-merge": return name;
      case "status": return name + ": " + L("status." + e.status) + (e.reason ? " — " + e.reason : "");
      case "plan": return name + ": " + count(e.plan && e.plan.subtasks) + " " + L("events.subtasks");
      case "planner-retry": return name + ": " + (e.error || "");
      case "usage": return name + ": " + e.agent + " " + ((e.inputTokens || 0) + (e.outputTokens || 0)) + " " + L("events.tokens") +
        (e.costUsd === undefined || e.costUsd === null ? "" : " " + money(e.costUsd));
      case "fallback": return name + ": " + e.from + " → " + e.to + " (" + (e.why || "") + ")";
      case "read-guard": return name + ": " + (e.agent || "") + " " + L("events.changed") + " " +
        (Array.isArray(e.files) ? e.files.join(", ") : "");
      case "conflict-resolved": return name + ": " + count(e.files) + " " + L("events.files");
      case "verify": return name + ": " + (e.ok ? L("events.ok") : L("events.failed")) + ", " + count(e.findings) + " " + L("events.findings") +
        (e.command ? " — " + e.command : "");
      case "fix": return name + " " + L("events.round") + " " + e.round + ": " + count(e.files) + " " + L("events.files");
      case "build": return name + ": " + (e.ok ? L("events.ok") : L("events.failed"));
      default: return String(e.type) + scalar(e);
    }
  }

  function scalar(e) {
    for (const k in e) {
      if (k === "ts" || k === "type") continue;
      if (typeof e[k] === "string" || typeof e[k] === "number") return ": " + k + "=" + e[k];
    }
    return "";
  }

  /** The browser reconnects with Last-Event-ID on its own, so there is no resume logic here. */
  function openStream(ctx) {
    stream = new EventSource(runApi(ctx.p, ctx.id) + "/events");
    stream.onmessage = (m) => {
      let e;
      try { e = JSON.parse(m.data); } catch (err) { return; }  // a half-written line is not an event
      if (!e || typeof e !== "object") return;
      if (e.type === "verify") { ctx.verifyEvent = e; paintVerify(ctx, e); }
      pushEvent(ctx, e);
      // agent lines stream by the hundred: repainting the run per line hammered the API; status, verify
      // and usage change what the summary shows, and a burst of them collapses into one refresh
      if (e.type === "status" || e.type === "verify" || e.type === "usage") scheduleRefresh(ctx);
    };
  }

  // ------------------------------------------------------------- lessons

  const isPending = (l) => l.meta && l.meta.status === "pending";

  async function renderLessons(main, p, seq) {
    clear(main);
    main.appendChild(text("p", "muted", L("common.loading")));
    const rows = await api(projectApi(p) + "/lessons");
    if (stale(seq)) return;
    if (!rows) { clear(main); return; }
    clear(main);
    main.appendChild(h("h1", null, L("lessons.title")));
    const group = (title, list, card) => section(title, list.length
      ? h("div", { className: "lessons-list" }, list.map((l) => card(p, l)))
      : text("p", "muted", L("lessons.empty")));
    main.appendChild(group(L("lessons.pending"), rows.filter(isPending), pendingLesson));
    main.appendChild(group(L("lessons.active"), rows.filter((l) => !isPending(l)), activeLesson));
  }

  function pendingLesson(p, l) {
    const m = l.meta || {};
    const evidence = m.evidence || [];
    return h("div", { className: "lesson" },
      text("p", "lesson-text", l.text),
      l.safety !== "ok" ? text("p", "warn", "⚠ " + L("heldBySafety")) : null,
      h("div", { className: "meta" },
        (m.roles || []).length ? meta(L("lessons.roles"), m.roles.join(", ")) : null,
        meta(L("lessons.seen"), String(m.seen || 0)),
        meta(L("lessons.uses"), String(m.uses || 0))),
      evidence.length ? h("div", { className: "evidence" },
        h("span", { className: "m-k" }, L("lessons.evidence")),
        h("ul", null, evidence.map((e) => h("li", null, e)))) : null,
      h("div", { className: "acts" }, lessonButton(p, l.key, "approve"), lessonButton(p, l.key, "forget")));
  }

  function activeLesson(p, l) {
    return h("div", { className: "lesson" },
      text("p", "lesson-text", l.text),
      h("div", { className: "meta" }, meta(L("lessons.uses"), String((l.meta && l.meta.uses) || 0))),
      h("div", { className: "acts" }, lessonButton(p, l.key, "promote"), lessonButton(p, l.key, "forget")));
  }

  /** One lesson action, then a full re-render: the list and the sidebar counts both moved. */
  function lessonButton(p, key, action) {
    const gone = action === "forget";
    const btn = h("button", { className: gone ? "btn danger" : "btn" }, action === "approve" ? L("approve") : gone ? L("forget") : L("promote"));
    btn.onclick = async () => {
      if (gone && !confirm(L("confirmForget"))) return;
      btn.disabled = true;
      const ok = await api(projectApi(p) + "/lessons/" + encodeURIComponent(key) + "/" + action, { method: "POST" });
      btn.disabled = false;
      if (ok) render();
    };
    return btn;
  }

  // -------------------------------------------------------------- drafts

  async function renderDrafts(main, p, seq) {
    clear(main);
    main.appendChild(text("p", "muted", L("common.loading")));
    const rows = await api(projectApi(p) + "/drafts");
    if (stale(seq)) return;
    if (!rows) { clear(main); return; }
    clear(main);
    main.appendChild(h("h1", null, L("drafts.title")));
    if (!rows.length) { main.appendChild(text("p", "muted", L("drafts.empty"))); return; }
    for (const d of rows) main.appendChild(draftCard(p, d));
  }

  function draftCard(p, d) {
    const pre = h("pre", { className: "skill" });
    pre.textContent = d.text || "";
    return section(d.kind,
      d.description ? text("p", "muted", d.description) : null,
      pre,
      h("div", { className: "acts" },
        draftButton(p, d.kind, "approve", L("approve"), L("confirmApproveDraft")),
        draftButton(p, d.kind, "reject", L("reject"), L("confirmRejectDraft"))));
  }

  function draftButton(p, kind, action, label, ask) {
    const btn = h("button", { className: action === "reject" ? "btn danger" : "btn" }, label);
    btn.onclick = async () => {
      if (!confirm(ask)) return;
      btn.disabled = true;
      const ok = await api(projectApi(p) + "/drafts/" + encodeURIComponent(kind) + "/" + action, { method: "POST" });
      btn.disabled = false;
      if (ok) render();
    };
    return btn;
  }

  // ------------------------------------------------------------- new run

  const TASK_MIN = 3;
  const TASK_MAX = 2000;

  async function renderNew(main, p, seq) {
    clear(main);
    main.appendChild(text("p", "muted", L("common.loading")));
    const pre = await api(projectApi(p) + "/preflight");
    if (stale(seq)) return;
    if (!pre) { clear(main); return; }
    const problems = pre.problems || [];
    clear(main);
    main.appendChild(h("h1", null, L("new.title")));

    // a textarea is not one of h()'s props, so its value and handler are set here
    const area = h("textarea", { className: "task" });
    const quick = h("input", { type: "checkbox" });
    const counter = text("p", "note", "");
    const start = h("button", { className: "btn" }, L("startRun"));
    const sync = () => {
      const v = area.value;
      counter.textContent = v.length + " / " + TASK_MAX + " " + L("new.counter");
      start.disabled = problems.length > 0 || v.trim().length < TASK_MIN || v.length > TASK_MAX;
    };
    area.oninput = sync;
    start.onclick = async () => {
      start.disabled = true;
      const r = await api(projectApi(p) + "/runs", { method: "POST", body: { task: area.value.trim(), ...(quick.checked ? { quick: true } : {}) } });
      if (!r || !r.id) { sync(); return; }       // the banner says why; the task stays for a retry
      location.hash = "#/p/" + encodeURIComponent(p) + "/runs/" + encodeURIComponent(r.id);
    };

    main.appendChild(section(L("new.task"), area, counter, h("label", { className: "quick" }, quick, L("new.quick"))));
    if (problems.length) main.appendChild(section(L("new.problems"), h("ul", { className: "problems" }, problems.map((s) => h("li", null, s)))));
    main.appendChild(h("div", { className: "acts" }, start));
    sync();
    area.focus();
  }

  // --------------------------------------------------------------- queue

  /** The daemon's queue, across every project: what it will run, and what came of it. */
  async function renderQueue(main, seq) {
    clear(main);
    main.appendChild(text("p", "muted", L("common.loading")));
    const jobs = await api("/api/queue");
    const projects = jobs && await api("/api/projects");   // a second request would clear the first one's banner
    if (stale(seq)) return;
    if (!jobs || !projects) { clear(main); return; }   // the banner says why
    clear(main);
    main.appendChild(h("h1", null, L("queue.title")));
    main.appendChild(addToQueue(projects));
    main.appendChild(jobs.length ? queueTable(jobs) : text("p", "muted", L("queue.empty")));
  }

  function addToQueue(projects) {
    const pick = h("select", null);
    for (const p of projects.filter((p) => !p.missing)) {
      const opt = h("option", null, p.name);
      opt.value = p.id;                            // value is not one of h()'s props
      pick.appendChild(opt);
    }
    const area = h("textarea", { className: "task" });
    const quick = h("input", { type: "checkbox" });
    const counter = text("p", "note", "");
    const add = h("button", { className: "btn" }, L("queue.add"));
    const sync = () => {
      const v = area.value;
      counter.textContent = v.length + " / " + TASK_MAX + " " + L("new.counter");
      add.disabled = !pick.options.length || v.trim().length < TASK_MIN || v.length > TASK_MAX;
    };
    area.oninput = sync;
    add.onclick = async () => {
      add.disabled = true;
      const r = await api("/api/queue", { method: "POST", body: { projectId: pick.value, task: area.value.trim(), ...(quick.checked ? { quick: true } : {}) } });
      if (!r || !r.id) { sync(); return; }          // the banner says why; the task stays for a retry
      render();
    };
    sync();
    return section(L("queue.add"), pick, area, counter, h("label", { className: "quick" }, quick, L("new.quick")), h("div", { className: "acts" }, add));
  }

  function queueTable(jobs) {
    const head = h("tr", null, [L("queue.project"), L("queue.source"), L("queue.status"), L("runs.task"), L("queue.result"), ""].map((t) => h("th", null, t)));
    return h("table", { className: "runs" }, h("thead", null, head), h("tbody", null, jobs.map(jobRow)));
  }

  function jobRow(j) {
    const task = String(j.task || "").split(/\r?\n/)[0];
    return h("tr", null,
      h("td", null, j.project),
      h("td", null, j.source),
      h("td", null, statusSpan(j.status)),
      h("td", { title: j.task || "" }, truncate(task, 80)),
      h("td", null, jobResult(j.result)),
      h("td", null, j.status === "queued" ? removeJob(j.id) : null));
  }

  /** The daemon writes the PR URL here once there is one, and otherwise why there is not. */
  function jobResult(result) {
    if (!result) return null;
    if (/^https:\/\//.test(result)) return h("a", { href: result, rel: "noreferrer", target: "_blank" }, result);
    return text("span", "muted", result);
  }

  function removeJob(id) {
    const btn = h("button", { className: "btn danger" }, L("queue.remove"));
    btn.onclick = async () => {
      btn.disabled = true;                         // one click per request; a job that already started comes back as a 409
      const ok = await api("/api/queue/" + encodeURIComponent(id), { method: "DELETE" });
      btn.disabled = false;
      if (ok) render();
    };
    return btn;
  }

  // -------------------------------------------------------------- router

  let timer = null;                              // runs refresh or active-run elapsed tick
  let stream = null;                             // the run detail's EventSource
  let refreshPending = null;                     // a coalesced run-detail refresh
  let starting = null;                           // loadRun waiting on a run that has not been written yet
  let seqNo = 0;                                 // a render in flight when the route changed must not paint
  const stale = (seq) => seq !== seqNo;

  function scheduleRefresh(ctx) {
    if (refreshPending) return;
    refreshPending = setTimeout(() => { refreshPending = null; refreshRun(ctx); }, 300);
  }

  function teardown() {
    if (timer) { clearInterval(timer); timer = null; }
    if (refreshPending) { clearTimeout(refreshPending); refreshPending = null; }
    if (starting) { clearTimeout(starting); starting = null; }
    if (stream) { stream.close(); stream = null; }
  }

  /** A hand-typed hash can be malformed; an undecodable segment matches no project and lands on home. */
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

  /** #/ · #/queue · #/p/:p/runs · #/p/:p/runs/:id · #/p/:p/lessons · #/p/:p/drafts · #/p/:p/new */
  function route() {
    const parts = String(location.hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).map(decode);
    if (parts[0] === "queue") return { screen: "queue" };
    if (parts[0] !== "p" || !parts[1]) return { screen: "home" };
    const p = parts[1];
    if (parts[2] === "runs") return { screen: "runs", p: p, id: parts[3] };
    if (parts[2] === "lessons" || parts[2] === "drafts" || parts[2] === "new") return { screen: parts[2], p: p };
    return { screen: "home" };
  }

  async function render() {
    teardown();
    const seq = ++seqNo;
    const r = route();
    const main = document.getElementById("main");
    document.getElementById("sidebar").classList.remove("open");
    const projects = await api("/api/projects");
    const daemon = projects && await api("/api/daemon");   // a second request would clear the first one's banner
    if (stale(seq)) return;
    renderSidebar(projects || [], r, daemon);
    if (r.screen === "runs" && r.id) await renderRun(main, r.p, r.id, seq);
    else if (r.screen === "runs") await renderRuns(main, r.p, seq);
    else if (r.screen === "home") await renderHome(main, projects || [], seq);
    else if (r.screen === "queue") await renderQueue(main, seq);
    else if (r.screen === "lessons") await renderLessons(main, r.p, seq);
    else if (r.screen === "drafts") await renderDrafts(main, r.p, seq);
    else await renderNew(main, r.p, seq);        // route() only leaves "new"
  }

  function boot() {
    const menu = document.getElementById("menu");
    menu.textContent = L("nav.menu");
    menu.onclick = () => document.getElementById("sidebar").classList.toggle("open");
    window.addEventListener("hashchange", render);
    window.addEventListener("beforeunload", teardown);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
