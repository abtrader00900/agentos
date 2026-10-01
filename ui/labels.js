/**
 * Every visible string in the dashboard.
 *
 * app.js reads them through L(key) and never hard-codes text, so the whole UI
 * can be re-worded (or translated) from this one file. Keys are dotted and
 * grouped by area; `status.*`, `icon.*`, `stage.*`, `sub.*`, `sev.*` and `ev.*`
 * are looked up dynamically, so each one needs an entry for every value the
 * engine can produce.
 *
 * Loaded as a bare script before app.js: it may touch nothing but `window`.
 */
window.LABELS = {
  // shell and sidebar
  "nav.brand": "agentos",
  "nav.menu": "Menu",
  "nav.projects": "All projects",
  "nav.runs": "Runs",
  "nav.lessons": "Lessons",
  "nav.drafts": "Skill drafts",
  "nav.new": "New run",
  "nav.missing": "missing",
  "nav.remove": "Remove",
  "nav.noProjects": "No projects yet — run agentos in a repo to register one",

  // all projects
  "home.title": "All projects",
  "home.running": "Running",
  "home.needsYou": "Needs you",
  "home.lessons": "Pending lessons",
  "home.drafts": "Skill drafts",
  "home.weekRuns": "Runs this week",
  "home.weekPrs": "PRs this week",
  "home.weekCost": "Cost this week",
  "home.nothing": "Nothing needs you right now",
  "home.pendingLessons": "lessons waiting for review",
  "home.draftsWaiting": "skill drafts waiting for review",

  // runs table
  "runs.title": "Runs",
  "runs.task": "Task",
  "runs.status": "Status",
  "runs.rounds": "Rounds",
  "runs.cost": "Cost",
  "runs.age": "Age",
  "runs.new": "+ New run",
  "runs.empty": "No runs yet",

  // run detail
  "run.starting": "Starting…",
  "run.round": "Fix round",
  "run.elapsed": "Elapsed",
  "run.cost": "Cost",
  "run.agents": "Agents",
  "run.cancel": "Cancel",
  "run.resume": "Resume",
  "run.plan": "Plan",
  "run.subtasks": "Subtasks",
  "run.noSubtasks": "No subtasks yet",
  "run.verify": "Last verify",
  "run.verifyOk": "Verify passed",
  "run.verifyFailed": "Verify failed",
  "run.noVerify": "Not verified yet",
  "run.command": "Failing command",
  "run.findings": "Review findings",
  "run.lessonsUsed": "Lessons used",
  "run.pr": "Pull request",
  "run.events": "Live events",
  "run.noEvents": "Waiting for events",
  "run.showAgent": "Show agent output",
  "run.diff": "Diff",
  "run.showDiff": "Show diff",
  "run.diffTruncated": "Diff truncated — open the branch locally for the rest",

  // stage bar
  "stage.queued": "queued",
  "stage.planning": "planning",
  "stage.working": "working",
  "stage.verifying": "verifying",
  "stage.fixing": "fixing",
  "stage.pr": "PR",
  "stage.learning": "learning",

  // run statuses, and the icon shown next to each
  "status.queued": "queued",
  "status.planning": "planning",
  "status.working": "working",
  "status.verifying": "verifying",
  "status.fixing": "fixing",
  "status.paused": "paused",
  "status.pr_open": "PR open",
  "status.needs_human": "needs you",
  "status.failed": "failed",
  "status.cancelled": "cancelled",
  "status.unreadable": "unreadable",
  "icon.queued": "·",
  "icon.planning": "◇",
  "icon.working": "▶",
  "icon.verifying": "◆",
  "icon.fixing": "↻",
  "icon.paused": "⏸",
  "icon.pr_open": "✓",
  "icon.needs_human": "!",
  "icon.failed": "✗",
  "icon.cancelled": "—",
  "icon.unreadable": "?",

  // subtask statuses and finding severities
  "sub.pending": "pending",
  "sub.running": "running",
  "sub.done": "done",
  "sub.failed": "failed",
  "sev.high": "high",
  "sev.medium": "medium",
  "sev.low": "low",

  // one word per event type, plus the units a summary line needs
  "ev.start": "start",
  "ev.resume": "resume",
  "ev.stale-lock": "stale lock",
  "ev.abort-stale-merge": "aborted a stale merge",
  "ev.status": "status",
  "ev.plan": "plan",
  "ev.planner-retry": "planner retry",
  "ev.usage": "usage",
  "ev.agent": "agent",
  "ev.fallback": "fallback",
  "ev.conflict-resolved": "conflict resolved",
  "ev.verify": "verify",
  "ev.fix": "fix",
  "ev.build": "build",
  "events.subtasks": "subtasks",
  "events.files": "files",
  "events.findings": "findings",
  "events.round": "round",
  "events.tokens": "tokens",
  "events.ok": "ok",
  "events.failed": "failed",

  // durations, joined without a space: "4m 12s", "3m ago"
  "time.s": "s",
  "time.m": "m",
  "time.h": "h",
  "time.d": "d",
  "time.ago": "ago",
  "time.now": "just now",

  "err.generic": "Something went wrong",
  "err.network": "Cannot reach the dashboard — is agentos ui still running?",

  "common.loading": "Loading",

  // lessons, skill drafts and new run: the buttons are undotted, they read as verbs
  "approve": "Approve",
  "forget": "Forget",
  "promote": "Promote",
  "reject": "Reject",
  "startRun": "Start run",
  "heldBySafety": "Held by the safety check — read it before approving",
  "confirmForget": "Forget this lesson?",
  "confirmApproveDraft": "Install this skill?",
  "confirmRejectDraft": "Reject and delete this draft?",

  "lessons.title": "Lessons",
  "lessons.pending": "Pending",
  "lessons.active": "Active",
  "lessons.empty": "Nothing here yet",
  "lessons.roles": "Roles",
  "lessons.evidence": "Evidence",
  "lessons.seen": "Seen",
  "lessons.uses": "Uses",

  "drafts.title": "Skill drafts",
  "drafts.empty": "No skill drafts waiting",

  "new.title": "New run",
  "new.task": "Task",
  "new.counter": "characters (3 minimum)",
  "new.problems": "Cannot start a run yet",
};
