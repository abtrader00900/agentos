import { createInterface } from "node:readline/promises";
import os from "node:os";
import { loadConfig } from "../core/loader.js";
import { deciderSchema } from "../core/schema.js";
import { installDecider } from "../decider/install.js";
import { deciderStatus, startDecider, stopDecider } from "../decider/service.js";
const urlOf = (cwd) => {
    try {
        return deciderSchema.parse(loadConfig(cwd).config.decider ?? {}).url;
    }
    catch {
        return deciderSchema.parse({}).url;
    }
};
async function confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return /^y(es)?$/i.test((await rl.question(question)).trim());
    }
    finally {
        rl.close();
    }
}
export async function deciderCommand(action, opts) {
    const url = urlOf(opts.cwd ?? process.cwd());
    switch (action) {
        case "install": {
            const r = await installDecider({ force: opts.force, confirm: opts.yes ? async () => true : confirm, log: (l) => console.log(l) });
            console.log(r === "installed" ? "✓ jevos installed — start it with: agentos decider start" : r === "already" ? "already installed (use --force to reinstall)" : "nothing downloaded");
            return;
        }
        case "start":
            console.log(`✓ decider running (pid ${await startDecider({ url, force: opts.force })}) at ${url}`);
            return;
        case "stop":
            console.log((await stopDecider({ url })) === "stopped" ? "decider stopped" : "the decider was not running");
            return;
        case "status": {
            const s = await deciderStatus({ url });
            console.log(!s.installed ? "not installed — agentos decider install" : s.running ? `running (pid ${s.pid ?? "?"}) at ${url}` : "installed, stopped — agentos decider start");
            console.log(`free memory: ${Math.round(os.freemem() / 1048576)} MB (jevos needs about 1–1.4 GB)`);
            return;
        }
        default: throw new Error(`unknown decider action "${action}" — use install, start, stop or status`);
    }
}
//# sourceMappingURL=decider.js.map