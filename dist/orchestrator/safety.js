const PATTERNS = [
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
    ["API key (sk-…)", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/],
    ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
];
/** Kinds of secret patterns found in text (no file/.env logic). */
export const secretHits = (text) => PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
/** Replace every secret-pattern match with *** */
export function maskSecrets(text) {
    let out = text;
    for (const [, re] of PATTERNS)
        out = out.replace(new RegExp(re.source, "g"), "***");
    return out;
}
/** Secrets in the lines a diff adds, and any .env file it adds or changes. */
export function scanDiff(diff) {
    const hits = [];
    let file = "";
    for (const line of diff.split("\n")) {
        if (line.startsWith("+++ ")) {
            file = line.slice(4).replace(/^b\//, "").trim();
            if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".example"))
                hits.push(`${file}: .env file`);
            continue;
        }
        if (!line.startsWith("+"))
            continue;
        for (const kind of secretHits(line))
            hits.push(`${file}: ${kind}`);
    }
    return [...new Set(hits)];
}
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
/**
 * Replace the values of secret-looking environment variables (values shorter than 6 are left) and every
 * secret-pattern match (a token a test or an agent printed) with ***.
 */
export function redact(text, env = process.env) {
    let out = text;
    for (const [name, value] of Object.entries(env)) {
        if (value && value.length >= 6 && SECRET_NAME.test(name))
            out = out.split(value).join("***");
    }
    return maskSecrets(out);
}
//# sourceMappingURL=safety.js.map