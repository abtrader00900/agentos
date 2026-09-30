#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./commands/init.js";
import { install } from "./commands/install.js";
import { sync } from "./commands/sync.js";
import { status } from "./commands/status.js";
import { skillList, skillInstall, skillSearch, skillTest } from "./commands/skill.js";
import { handoff, handoffShow } from "./commands/handoff.js";
import { doctor } from "./commands/doctor.js";
import { learn } from "./commands/learn.js";
import { run, runs } from "./commands/run.js";
import { createMemoryServer } from "./mcp/memory/server.js";
import { createSupersearchServer } from "./mcp/supersearch/server.js";
import { createCodegraphServer } from "./mcp/codegraph/server.js";
import { createOrchestratorServer } from "./mcp/orchestrator/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ALL_HARNESSES } from "./core/schema.js";
import { VERSION } from "./version.js";
const program = new Command();
/** a repeatable option: --question a --question b → ["a", "b"] */
const collect = (value, previous) => [...previous, value];
program
    .name("agentos")
    .description("Local-first, multi-harness agent operating system. Zero API dependency.")
    .version(VERSION);
program
    .command("init")
    .description("Create agent.config.yaml in the current project")
    .option("--force", "overwrite existing config")
    .action((opts) => {
    try {
        init({ force: opts.force });
    }
    catch (e) {
        fail(e);
    }
});
program
    .command("install")
    .description("Set up project: configs, .agentos/ dirs, skills, .gitignore")
    .option("--force", "overwrite hand-edited or pre-existing harness files (previous version kept as <file>.bak)")
    .action((opts) => {
    try {
        install({ force: opts.force });
    }
    catch (e) {
        fail(e);
    }
});
program
    .command("sync")
    .description("Regenerate all harness configs from agent.config.yaml")
    .option("--only <harnesses>", `comma-separated: ${ALL_HARNESSES.join(", ")}`)
    .option("--force", "overwrite hand-edited (drifted) or pre-existing files (previous version kept as <file>.bak)")
    .action((opts) => {
    try {
        const only = opts.only
            ? opts.only.split(",").map((s) => s.trim())
            : undefined;
        if (only) {
            for (const h of only) {
                if (!ALL_HARNESSES.includes(h))
                    fail(new Error(`Unknown harness "${h}". Valid: ${ALL_HARNESSES.join(", ")}`));
            }
        }
        sync({ only, force: opts.force });
    }
    catch (e) {
        fail(e);
    }
});
program
    .command("status")
    .description("Show project, harnesses, drift, and memory status")
    .option("--json", "machine-readable JSON output (for editor integrations)")
    .action((opts) => {
    try {
        status({ json: opts.json });
    }
    catch (e) {
        fail(e);
    }
});
const mcp = program.command("mcp").description("Run MCP servers (for harness registration)");
mcp
    .command("memory")
    .description("Run the memory MCP server over stdio")
    .action(async () => {
    const server = createMemoryServer();
    await server.connect(new StdioServerTransport());
});
mcp
    .command("supersearch")
    .description("Run the supersearch MCP server over stdio (text/symbol/git-history search)")
    .action(async () => {
    const server = createSupersearchServer();
    await server.connect(new StdioServerTransport());
});
mcp
    .command("codegraph")
    .description("Run the codegraph MCP server over stdio (dependency graph + impact analysis)")
    .action(async () => {
    const server = createCodegraphServer();
    await server.connect(new StdioServerTransport());
});
mcp
    .command("orchestrator")
    .description("Run the orchestrator MCP server over stdio (run_task / run_status / run_cancel)")
    .action(async () => {
    const server = createOrchestratorServer();
    await server.connect(new StdioServerTransport());
});
const skill = program.command("skill").description("Manage AgentOS skills");
skill
    .command("list")
    .description("List bundled + installed skills")
    .option("--json", "machine-readable JSON output (for editor integrations)")
    .action((opts) => { try {
    skillList({ json: opts.json });
}
catch (e) {
    fail(e);
} });
skill
    .command("install <name>")
    .description("Install a skill: bundled name, registry name, owner/repo[#dir], or git URL")
    .action(async (name) => { try {
    await skillInstall(name);
}
catch (e) {
    fail(e);
} });
skill
    .command("search <query>")
    .description("Search bundled skills + the configured community registry (Issue #3)")
    .action(async (query) => { try {
    await skillSearch(query);
}
catch (e) {
    fail(e);
} });
skill
    .command("test")
    .description("Validate all skills (frontmatter, structure, tests)")
    .action(() => { try {
    skillTest();
}
catch (e) {
    fail(e);
} });
program
    .command("handoff")
    .description("Export full agent context (task, decisions, memory, git) for another harness — FR-7")
    .option("--to <harness>", `target harness: ${ALL_HARNESSES.join(" | ")} | any`)
    .option("--from <harness>", "source harness (auto-detected if omitted)")
    .option("--task <text>", "REQUIRED: what was being worked on + current state")
    .option("--file <path>", "a file in progress (repeatable)", collect, [])
    .option("--files <list>", "files in progress, separated by , or ;", collect, [])
    .option("--decision <text>", "a pending decision (repeatable; commas stay inside it)", collect, [])
    .option("--decisions <list>", "pending decisions, separated by ; or newlines", collect, [])
    .option("--question <text>", "an open question (repeatable; commas stay inside it)", collect, [])
    .option("--questions <list>", "open questions, separated by ; or newlines", collect, [])
    .option("--notes <text>", "free-form notes")
    .option("--clear", "remove HANDOFF.md (finished work) so sync stops injecting it; bundles are kept")
    .action((opts) => {
    try {
        handoff({
            ...opts,
            files: [...opts.file, ...opts.files],
            decisions: [...opts.decision, ...opts.decisions],
            questions: [...opts.question, ...opts.questions],
        });
    }
    catch (e) {
        fail(e);
    }
});
program
    .command("handoff:show")
    .description("Print the latest handoff bundle")
    .action(() => { try {
    handoffShow();
}
catch (e) {
    fail(e);
} });
program
    .command("run [task...]")
    .description("Hand a task to the agent team: plan → parallel agents → tests + cross-model review → pull request")
    .option("--resume <id>", "continue a paused or interrupted run")
    .option("--cancel <id>", "stop a run (its worktrees are kept)")
    .option("--status <id>", "print a run's full state as JSON")
    .option("--id <id>", "use this run id (used by the orchestrator MCP server)")
    .action(async (words, opts) => {
    try {
        const task = words.join(" ").trim();
        if (!task && !opts.resume && !opts.cancel && !opts.status) {
            fail(new Error('Give a task: agentos run "add a discount field to customers"'));
        }
        process.exitCode = await run(task, opts);
    }
    catch (e) {
        fail(e);
    }
});
program
    .command("runs")
    .description("List orchestrator runs, newest first")
    .option("--json", "machine-readable JSON output")
    .option("--limit <n>", "show only the n newest runs", Number)
    .action((opts) => { try {
    runs({ json: opts.json, limit: opts.limit });
}
catch (e) {
    fail(e);
} });
program
    .command("doctor")
    .description("Health check: config, harnesses, drift, MCP, memory, skills, handoff")
    .option("--json", "machine-readable JSON output (for editor integrations)")
    .action((opts) => {
    try {
        if (opts.json) {
            const { checks, ok } = doctor({ quiet: true });
            console.log(JSON.stringify({ ok, checks }, null, 2));
            if (!ok)
                process.exit(1);
            return;
        }
        const { ok } = doctor();
        if (!ok)
            process.exit(1);
    }
    catch (e) {
        fail(e);
    }
});
program
    .command("learn")
    .description("Learn rules from git history (co-changing files, hot spots) — auto-improvement loop")
    .option("--apply", "append suggestions to agent.config.local.yaml (review, then promote)")
    .action((opts) => { try {
    learn({ apply: opts.apply });
}
catch (e) {
    fail(e);
} });
function fail(e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
}
program.parseAsync(process.argv);
//# sourceMappingURL=cli.js.map