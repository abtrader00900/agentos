import { describe, it, expect } from "vitest";
import { scanDiff, redact } from "../../src/orchestrator/safety.js";

// built at runtime so this file holds no key-shaped strings (push protection, scanners)
const AWS = "AKIA" + "Q".repeat(16);
const GH = "ghp_" + "a".repeat(36);

const diff = (file: string, lines: string[]) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${lines.join("\n")}\n`;

describe("scanDiff", () => {
  it("finds secrets on added lines only", () => {
    expect(scanDiff(diff("src/a.ts", [`+const k = "${AWS}";`, `-const old = "${GH}";`]))).toEqual(["src/a.ts: AWS access key"]);
  });

  it("flags .env files but not .env.example", () => {
    expect(scanDiff(diff("server/.env", ["+APP_KEY=x"]))).toEqual(["server/.env: .env file"]);
    expect(scanDiff(diff(".env.example", ["+APP_KEY="]))).toEqual([]);
  });

  it("finds private keys and GitHub tokens", () => {
    const hits = scanDiff(diff("k.pem", ["+-----BEGIN RSA PRIVATE KEY-----", `+token=${GH}`]));
    expect(hits).toEqual(["k.pem: private key", "k.pem: GitHub token"]);
  });
});

describe("redact", () => {
  it("hides the values of secret-looking environment variables", () => {
    const env = { API_KEY: "s3cr3t-value", DB_PASSWORD: "hunter22", PATH: "/usr/bin", SHORT_TOKEN: "abc" };
    expect(redact("key=s3cr3t-value pw=hunter22 path=/usr/bin t=abc", env)).toBe("key=*** pw=*** path=/usr/bin t=abc");
  });

  it("also masks secret patterns that are in no environment variable", () => {
    expect(redact(`t=${GH} k=${AWS} ok`, {})).toBe("t=*** k=*** ok");
  });
});
