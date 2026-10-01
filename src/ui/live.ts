import { closeSync, existsSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { runDir } from "../orchestrator/run.js";
import { Http, runOf } from "./api.js";
import { getProject } from "./projects.js";
import type { UiOptions } from "./server.js";

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
function startFrom(url: URL, req: IncomingMessage): number {
  const last = req.headers["last-event-id"];
  const raw = url.searchParams.get("since") ?? (typeof last === "string" ? last : "");
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * The inode is the only field that both survives an append and changes on a
 * rename-replace. No timestamp is: where a filesystem records no birth time Node
 * reports `ctimeMs` (or 0) in its place, and `ctimeMs` moves on every append, so
 * mixing one in would read an appended line as a replacement and re-send the log.
 * ponytail: where `ino` is 0 (not every filesystem records one) identity is
 * constant and only a shrinking file is caught, as before.
 */
function identity(st: { dev: number; ino: number }): string {
  return `${st.dev}:${st.ino}`;
}

export function liveEvents(
  projectId: string,
  runId: string,
  opts: UiOptions,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  sec: Record<string, string>,
): { status: number; json: unknown } | null {
  const project = getProject(projectId, opts.home);
  if (!project || !existsSync(project.path)) return { status: 404, json: { error: `no such project: ${projectId}` } };
  let dir: string;
  try {
    dir = runDir(project.path, runId);
    runOf(project.path, runId);
  } catch (e) {
    if (e instanceof Http) return { status: e.status, json: { error: e.message } };
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
  let id = "";
  try {
    id = identity(statSync(file));
  } catch { /* the first logEvent has not created it yet, so the identity comes from the first poll */ }

  /** A closed request can still have a timer in flight for one more tick. */
  const write = (frame: string): void => { if (!res.writableEnded && !res.destroyed) res.write(frame); };

  const pump = (): void => {
    let fd: number;
    try {
      fd = openSync(file, "r");
    } catch {
      return; // the first logEvent has not created it yet
    }
    try {
      const st = fstatSync(fd);
      const now = identity(st);
      // A replaced or truncated log starts a new sequence from its first line; a
      // replacement that is not smaller only shows as a change of file identity.
      if (st.size < offset || (id && now !== id)) {
        offset = 0;
        partial = "";
        decoder = new StringDecoder("utf8");
        seen = 0;
        since = 0;
      }
      id = now;
      for (;;) {
        const n = readSync(fd, buf, 0, buf.length, offset);
        if (!n) break;
        offset += n;
        partial += decoder.write(buf.subarray(0, n)); // a read can stop mid-character
      }
    } finally {
      closeSync(fd);
    }
    const lines = partial.split("\n");
    partial = lines.pop() ?? ""; // the tail has no newline yet, so it is not a whole event
    for (const line of lines) {
      const data = line.replace(/\r$/, "");
      if (!data) continue; // a blank line is not an event and takes no id
      seen++;
      if (seen > since) write(`id: ${seen}\ndata: ${data}\n\n`);
    }
  };

  const heartbeat = (): void => write(": hb\n\n");

  heartbeat(); // flushes the head, so a client resuming with nothing pending still sees the stream open
  pump();
  const poll = setInterval(pump, POLL_MS);
  const beat = setInterval(heartbeat, HEARTBEAT_MS);
  req.on("close", () => { clearInterval(poll); clearInterval(beat); });
  return null;
}
