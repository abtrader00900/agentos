import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { binaryAsset, installDecider, isInstalled, MODEL_ASSET, parseSums } from "../../src/decider/install.js";
import { deciderDir } from "../../src/decider/client.js";

let home: string;
beforeEach(() => { home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "agentos-inst-"))); });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const files: Record<string, string> = { "jev-windows-x64.zip": "BIN", [MODEL_ASSET]: "MODEL" };

/** a fake release: download writes the asset's content; the sums file lists each sha (or a wrong one) */
function release(wrong?: string) {
  const got: string[] = [];
  const sums = Object.entries(files).map(([n, c]) => `${n === wrong ? sha("tampered") : sha(c)}  ${n}`).join("\n") + "\n";
  const download = async (url: string, file: string) => {
    got.push(url.split("/").pop()!);
    const name = url.split("/").pop()!;
    writeFileSync(file, name === "SHA256SUMS.txt" ? sums : files[name]);
  };
  /** stands in for tar: the binary archive makes jev/jev.exe, the model archive makes model/ */
  const unpack = (archive: string, dest: string) => {
    const name = path.basename(archive);
    if (name === MODEL_ASSET) mkdirSync(path.join(dest, "model"), { recursive: true });
    else { mkdirSync(path.join(dest, "jev"), { recursive: true }); writeFileSync(path.join(dest, "jev", "jev.exe"), "x"); }
  };
  return { got, download, unpack };
}

describe("decider install", () => {
  it("picks the asset for the platform", () => {
    expect(binaryAsset("win32", "x64")).toBe("jev-windows-x64.zip");
    expect(binaryAsset("linux", "x64")).toBe("jev-linux-x64.tar.gz");
    expect(binaryAsset("darwin", "arm64")).toBe("jev-macos-arm64.tar.gz");
    expect(() => binaryAsset("linux", "arm64")).toThrow(/no jevos build/);
  });

  it("reads SHA256SUMS lines", () => {
    expect(parseSums("abc123  jev.zip\nDEF  *model.zip\n")).toEqual(new Map([["jev.zip", "abc123"], ["model.zip", "def"]]));
  });

  it("asks first, downloads, checks every hash, unpacks, and records the version", async () => {
    const r = release();
    const asked: string[] = [];
    const out = await installDecider({ home, platform: "win32", arch: "x64", download: r.download, unpack: r.unpack, confirm: async (q) => { asked.push(q); return true; } });
    expect(out).toBe("installed");
    expect(asked[0]).toMatch(/650 MB/);
    expect(r.got).toEqual(["SHA256SUMS.txt", "jev-windows-x64.zip", MODEL_ASSET]);
    expect(isInstalled(home)).toBe(true);
    expect(readFileSync(path.join(deciderDir(home), "version"), "utf8").trim()).toBe("jevos-v2");
    expect(existsSync(path.join(deciderDir(home), MODEL_ASSET))).toBe(false);   // archives are removed
    expect(await installDecider({ home, platform: "win32", arch: "x64", download: r.download, unpack: r.unpack, confirm: async () => true })).toBe("already");
  });

  it("downloads nothing when the owner says no", async () => {
    const r = release();
    expect(await installDecider({ home, platform: "win32", arch: "x64", download: r.download, unpack: r.unpack, confirm: async () => false })).toBe("declined");
    expect(r.got).toEqual(["SHA256SUMS.txt"]);
    expect(isInstalled(home)).toBe(false);
  });

  it("a forced reinstall that fails leaves nothing counted as installed", async () => {
    const good = release();
    await installDecider({ home, platform: "win32", arch: "x64", download: good.download, unpack: good.unpack, confirm: async () => true });
    expect(isInstalled(home)).toBe(true);
    const bad = release(MODEL_ASSET);
    await expect(installDecider({ home, force: true, platform: "win32", arch: "x64", download: bad.download, unpack: bad.unpack, confirm: async () => true })).rejects.toThrow(/SHA-256 mismatch/);
    expect(isInstalled(home)).toBe(false);
  });

  it("refuses a file whose hash does not match, and leaves nothing unpacked", async () => {
    const r = release(MODEL_ASSET);
    await expect(installDecider({ home, platform: "win32", arch: "x64", download: r.download, unpack: r.unpack, confirm: async () => true })).rejects.toThrow(/SHA-256 mismatch.*jevos-v2-openvino-int8\.zip/);
    expect(isInstalled(home)).toBe(false);
    expect(existsSync(path.join(deciderDir(home), MODEL_ASSET))).toBe(false);
    expect(existsSync(path.join(deciderDir(home), `${MODEL_ASSET}.part`))).toBe(false);
  });
});
