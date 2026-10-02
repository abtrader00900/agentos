import { readFileSync } from "node:fs";
import path from "node:path";
import { agentosHome } from "../ui/projects.js";
export const deciderDir = (home = agentosHome()) => path.join(home, ".agentos", "jevos");
/** the API key `decider start` writes next to the install; undefined when there is none */
export function readKey(home = agentosHome()) {
    try {
        return readFileSync(path.join(deciderDir(home), "key"), "utf8").trim() || undefined;
    }
    catch {
        return undefined;
    }
}
/** One jevos request. Any failure (down, slow, malformed) is null: the decider is advice, never a dependency. */
export async function ask(url, state, questions, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000);
    try {
        const res = await fetch(`${url.replace(/\/+$/, "")}/v1/systemone`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}) },
            body: JSON.stringify({
                model: "jev-latest",
                state,
                questions: Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, { type: "noul", instructions: q }])),
            }),
            signal: ctrl.signal,
        });
        if (!res.ok)
            return null;
        const body = (await res.json());
        const out = {};
        for (const k of Object.keys(questions)) {
            const p = body.answers?.[k]?.noul;
            if (typeof p !== "number" || !(p >= 0 && p <= 1))
                return null;
            out[k] = p;
        }
        return out;
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
/** the Decide the engine gets: the configured url, with the local key when there is one */
export const decider = (cfg, home = agentosHome()) => (state, questions) => ask(cfg.url, state, questions, { key: readKey(home) });
//# sourceMappingURL=client.js.map