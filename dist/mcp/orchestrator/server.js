import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectRoot } from "../../core/project.js";
import { VERSION } from "../../version.js";
import { listRuns, loadRun, newRunId } from "../../orchestrator/run.js";
import { cancelRun } from "../../orchestrator/engine.js";
import { runLine } from "../../orchestrator/report.js";
/**
 * `agentos run --id <id> -- <task>` as a detached process: the run outlives the chat that asked for it.
 * No shell, so the task text is never parsed; "--" keeps a task that starts with a dash from being read as an option.
 */
export function spawnDetachedRun(root, id, task) {
    const cli = fileURLToPath(new URL("../../cli.js", import.meta.url));
    spawn(process.execPath, [cli, "run", "--id", id, "--", task], { cwd: root, detached: true, stdio: "ignore", windowsHide: true }).unref();
}
const text = (t) => ({ content: [{ type: "text", text: t }] });
export function createOrchestratorServer(root = projectRoot(), launch = spawnDetachedRun) {
    const server = new McpServer({ name: "agentos-orchestrator", version: VERSION });
    server.tool("run_task", "Hand a coding task to the agentos team: plan → parallel agents in git worktrees → tests + cross-model review → pull request. Returns a run id at once; the run continues in the background.", { task: z.string().min(3).describe("What to build or fix, in plain words") }, async ({ task }) => {
        const id = newRunId();
        launch(root, id, task);
        return text(`Started run ${id}. Check it with run_status {"id":"${id}"}; it ends with a pull request or a reason it needs you.`);
    });
    server.tool("run_status", "Status of one run (by id), or the 10 most recent runs.", { id: z.string().optional() }, async ({ id }) => {
        if (!id)
            return text(listRuns(root).slice(0, 10).map(runLine).join("\n") || "No runs yet.");
        const s = loadRun(root, id);
        const subs = s.subtasks.map((t) => `  ${t.id}  ${t.agent}  ${t.status}`).join("\n");
        return text(`${runLine(s)}${s.reason ? `\nreason: ${s.reason}` : ""}${subs ? `\n${subs}` : ""}`);
    });
    server.tool("run_cancel", "Cancel a running or paused run. Its worktrees are kept for inspection.", { id: z.string() }, async ({ id }) => text(runLine(await cancelRun(root, id))));
    return server;
}
//# sourceMappingURL=server.js.map