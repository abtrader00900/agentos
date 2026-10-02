import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { agentosHome } from "../ui/projects.js";
import { deciderDir } from "./client.js";
export const RELEASE_URL = "https://github.com/feder-cr/jev/releases/download/jevos-v2";
export const MODEL_ASSET = "jevos-v2-openvino-int8.zip";
const VERSION = "jevos-v2";
export function binaryAsset(platform = process.platform, arch = process.arch) {
    if (platform === "win32" && arch === "x64")
        return "jev-windows-x64.zip";
    if (platform === "linux" && arch === "x64")
        return "jev-linux-x64.tar.gz";
    if (platform === "darwin" && arch === "arm64")
        return "jev-macos-arm64.tar.gz";
    throw new Error(`no jevos build for ${platform}-${arch} (available: windows-x64, linux-x64, macos-arm64)`);
}
/** "<sha256>  <name>" lines (a "*" before the name marks binary mode) */
export function parseSums(text) {
    const m = new Map();
    for (const line of text.split("\n")) {
        const hit = /^([0-9a-fA-F]+)\s+\*?(.+?)\s*$/.exec(line);
        if (hit)
            m.set(hit[2], hit[1].toLowerCase());
    }
    return m;
}
const realDownload = async (url, file) => {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body)
        throw new Error(`download failed: ${url} (HTTP ${res.status})`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
};
/** Windows 10+ ships bsdtar as tar.exe, which reads zip files too */
const realUnpack = (archive, dest) => {
    try {
        execFileSync("tar", ["-xf", archive, "-C", dest], { stdio: "ignore", windowsHide: true });
    }
    catch (e) {
        throw new Error(`could not unpack ${path.basename(archive)} with tar (${e.message.split("\n")[0]}); unpack it by hand into ${dest} as the jevos README describes`);
    }
};
async function sha256(file) {
    const h = createHash("sha256");
    for await (const chunk of createReadStream(file))
        h.update(chunk);
    return h.digest("hex");
}
export const isInstalled = (home = agentosHome()) => existsSync(path.join(deciderDir(home), "version"));
export async function installDecider(opts) {
    const home = opts.home ?? agentosHome();
    const dir = deciderDir(home);
    const download = opts.download ?? realDownload;
    const unpack = opts.unpack ?? realUnpack;
    const log = opts.log ?? (() => { });
    if (isInstalled(home) && !opts.force)
        return "already";
    mkdirSync(dir, { recursive: true });
    const assets = [binaryAsset(opts.platform, opts.arch), MODEL_ASSET];
    const sumsFile = path.join(dir, "SHA256SUMS.txt");
    await download(`${RELEASE_URL}/SHA256SUMS.txt`, sumsFile);
    const sums = parseSums(readFileSync(sumsFile, "utf8"));
    if (!(await opts.confirm(`Download jevos (${assets.join(" + ")}, about 650 MB) from github.com/feder-cr/jev into ${dir}? [y/N] `)))
        return "declined";
    for (const asset of assets) {
        const want = sums.get(asset);
        if (!want)
            throw new Error(`${asset} is not listed in the release's SHA256SUMS.txt`);
        const part = path.join(dir, `${asset}.part`);
        log(`downloading ${asset}…`);
        try {
            await download(`${RELEASE_URL}/${asset}`, part);
            const got = await sha256(part);
            if (got !== want)
                throw new Error(`SHA-256 mismatch for ${asset}: expected ${want}, got ${got}`);
        }
        catch (e) {
            rmSync(part, { force: true });
            throw e;
        }
        renameSync(part, path.join(dir, asset));
    }
    unpack(path.join(dir, assets[0]), dir); // → <dir>/jev/
    unpack(path.join(dir, MODEL_ASSET), path.join(dir, "jev")); // → <dir>/jev/model/
    for (const a of assets)
        rmSync(path.join(dir, a), { force: true });
    writeFileSync(path.join(dir, "version"), `${VERSION}\n`);
    return "installed";
}
//# sourceMappingURL=install.js.map