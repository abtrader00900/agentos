import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { runDir } from "../orchestrator/run.js";
import { Http, runOf } from "./api.js";
import { getProject } from "./projects.js";
/**
 * `events.jsonl` as an SSE stream.
 *
 * The engine appends to the file from another process, so there is nothing to
 * subscribe to: the stream remembers a byte offset and re-reads the tail. An id
 * is the event's 1-based line number, which is all a client needs to resume with
 * `Last-Event-ID` after a reload or a dropped connection.
 *
 * This is not a route() handler: SSE needs the response itself, and the route
 * table only deals in `{ status, json }`. Returning a body means "not streaming,
 * send this instead"; `null` means the response has been taken over.
 */
const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;
const CHUNK = 64 * 1024;
/** `?since=` wins over the header, and anything that is not a whole count starts from the top. */
function startFrom(url, req) {
    const last = req.headers["last-event-id"];
    const raw = url.searchParams.get("since") ?? (typeof last === "string" ? last : "");
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
}
export function liveEvents(projectId, runId, opts, url, req, res, sec) {
    const project = getProject(projectId, opts.home);
    if (!project || !existsSync(project.path))
        return { status: 404, json: { error: `no such project: ${projectId}` } };
    let dir;
    try {
        dir = runDir(project.path, runId);
        runOf(project.path, runId);
    }
    catch (e) {
        if (e instanceof Http)
            return { status: e.status, json: { error: e.message } };
        throw e;
    }
    res.writeHead(200, { ...sec, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const file = path.join(dir, "events.jsonl");
    let since = startFrom(url, req);
    const buf = Buffer.allocUnsafe(CHUNK);
    let decoder = new StringDecoder("utf8");
    let offset = 0;
    let partial = "";
    let seen = 0;
    /** A closed request can still have a timer in flight for one more tick. */
    const write = (frame) => { if (!res.writableEnded && !res.destroyed)
        res.write(frame); };
    const pump = () => {
        let fd;
        try {
            fd = openSync(file, "r");
        }
        catch {
            return; // the first logEvent has not created it yet
        }
        try {
            if (fstatSync(fd).size < offset) {
                // A replaced or truncated log starts a new sequence from its first line.
                offset = 0;
                partial = "";
                decoder = new StringDecoder("utf8");
                seen = 0;
                since = 0;
            }
            for (;;) {
                const n = readSync(fd, buf, 0, buf.length, offset);
                if (!n)
                    break;
                offset += n;
                partial += decoder.write(buf.subarray(0, n)); // a read can stop mid-character
            }
        }
        finally {
            closeSync(fd);
        }
        const lines = partial.split("\n");
        partial = lines.pop() ?? ""; // the tail has no newline yet, so it is not a whole event
        for (const line of lines) {
            const data = line.replace(/\r$/, "");
            if (!data)
                continue; // a blank line is not an event and takes no id
            seen++;
            if (seen > since)
                write(`id: ${seen}\ndata: ${data}\n\n`);
        }
    };
    const heartbeat = () => write(": hb\n\n");
    heartbeat(); // flushes the head, so a client resuming with nothing pending still sees the stream open
    pump();
    const poll = setInterval(pump, POLL_MS);
    const beat = setInterval(heartbeat, HEARTBEAT_MS);
    req.on("close", () => { clearInterval(poll); clearInterval(beat); });
    return null;
}
//# sourceMappingURL=live.js.map