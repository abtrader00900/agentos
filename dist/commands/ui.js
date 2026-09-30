import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { git } from "../orchestrator/workspace.js";
import { registerProject } from "../ui/projects.js";
import { startUi } from "../ui/server.js";
export async function ui(opts) {
    // The same root `agentos run` registers, so both dedupe to one entry. Outside a
    // git repo rev-parse throws and nothing is registered: the dashboard lists the
    // projects runs have visited, not whichever folder `agentos ui` was typed in.
    try {
        registerProject(git(process.cwd(), ["rev-parse", "--show-toplevel"]));
    }
    catch { /* dashboard works without the registry */ }
    const token = randomBytes(32).toString("hex");
    const { url } = await startUi({ token, port: opts.port });
    console.log(`agentos dashboard: ${url}`);
    if (opts.open === false)
        return;
    try {
        const [command, args] = process.platform === "win32"
            ? ["cmd", ["/c", "start", "", url]]
            : process.platform === "darwin"
                ? ["open", [url]]
                : ["xdg-open", [url]];
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.on("error", () => { });
        child.unref();
    }
    catch { /* a missing browser opener never stops the dashboard */ }
}
//# sourceMappingURL=ui.js.map