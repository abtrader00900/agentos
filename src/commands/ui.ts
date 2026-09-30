import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { projectRoot } from "../core/project.js";
import { registerProject } from "../ui/projects.js";
import { startUi } from "../ui/server.js";

export async function ui(opts: { port: number; open?: boolean }): Promise<void> {
  try { registerProject(projectRoot()); } catch { /* dashboard works without the registry */ }

  const token = randomBytes(32).toString("hex");
  const { url } = await startUi({ token, port: opts.port });
  console.log(`agentos dashboard: ${url}`);

  if (opts.open === false) return;
  try {
    const [command, args] = process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]] as const
      : process.platform === "darwin"
        ? ["open", [url]] as const
        : ["xdg-open", [url]] as const;
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch { /* a missing browser opener never stops the dashboard */ }
}
