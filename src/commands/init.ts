import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { PKG } from "../version.js";
import { DEFAULT_RISK } from "../orchestrator/gates.js";

// No version in the template: sync pins the servers to the CLI that runs it (generators/shared.ts).
const MCP_SERVERS = `mcpServers:
  - name: memory
    command: npx
    args: ["-y", "${PKG}", "mcp", "memory"]
  - name: supersearch
    command: npx
    args: ["-y", "${PKG}", "mcp", "supersearch"]
  - name: codegraph
    command: npx
    args: ["-y", "${PKG}", "mcp", "codegraph"]
`;

const TEMPLATE = `# AgentOS project config — single source of truth for all agent harnesses.
# Docs: https://github.com/abtrader00900/agentos

project:
  name: my-project
  description: ""

stack:
  - typescript

rules:
  - id: run-tests-first
    text: Before marking any task done, run the project test suite and paste results.
  - id: no-guessing-deps
    text: Use the codegraph MCP tools to verify dependencies instead of guessing imports.

skills:
  - name: tdd-laravel   # remove if not a Laravel project

${MCP_SERVERS}`;

type SaasStack = { kind: "laravel" | "nextjs" | "node"; stack: string[]; verify: string[]; skills: string[] };

const STACKS: Record<SaasStack["kind"], SaasStack> = {
  laravel: { kind: "laravel", stack: ["php", "laravel"], verify: ["php artisan test"], skills: ["saas-builder", "ponytail", "tdd-laravel"] },
  nextjs: { kind: "nextjs", stack: ["typescript", "nextjs", "react"], verify: ["npm test", "npx tsc --noEmit"], skills: ["saas-builder", "ponytail", "tdd-react"] },
  node: { kind: "node", stack: ["typescript", "node"], verify: ["npm test"], skills: ["saas-builder", "ponytail"] },
};

/** composer.json wins; then a package.json that depends on next; otherwise plain node */
function detectStack(cwd: string): SaasStack {
  if (existsSync(path.join(cwd, "composer.json"))) return STACKS.laravel;
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (pkg.dependencies?.next || pkg.devDependencies?.next) return STACKS.nextjs;
  } catch {
    /* no or unreadable package.json */
  }
  return STACKS.node;
}

const SAAS_RULES: [string, string][] = [
  ["plan-first", "State the plan and wait for approval before touching the data model, auth, money or infrastructure."],
  ["prove-not-claim", "Run lint, typecheck and tests, and paste the output before you say something is done."],
  ["never-weaken-tests", "Never skip, delete or loosen a test to make it pass — ask instead."],
  ["honest-report", "End every task with what changed, what is not done, what you assumed and what you did not verify."],
  ["secrets-in-env", "No secrets in code, logs or the repo; only their names go in .env.example."],
  ["ask-before-deps", "Ask before adding a dependency."],
  ["endpoint-checklist", "Every endpoint needs input validation, an authorization check and tests."],
  ["migrations-only", "Change the database only through migration files."],
  ["record-decisions", "Write hard-to-reverse choices to docs/decisions/NNNN-title.md."],
];

const DECISIONS_README = `# Decision records

One file per hard-to-reverse choice: \`NNNN-short-title.md\`, numbered in order (\`0001-\`, \`0002-\`, …).

Each file has five short sections:

- **Context** — what forced the choice.
- **Options** — what was on the table.
- **Choice** — what was picked.
- **Why** — what made it win, and what it costs.
- **Date** — YYYY-MM-DD.

Never rewrite an old record. Superseded it? Add a new one and link back.
`;

// indent one level so it nests under `orchestrator:` — generated from DEFAULT_RISK so the template can't drift
const riskYaml = stringify({ risk: DEFAULT_RISK })
  .trimEnd()
  .split("\n")
  .map((l) => `  ${l}`)
  .join("\n");

function saasTemplate(s: SaasStack): string {
  return `# AgentOS SaaS project config — single source of truth for all agent harnesses.
# Detected stack: ${s.kind}. Docs: https://github.com/abtrader00900/agentos

project:
  name: my-project
  description: ""

stack:
${s.stack.map((x) => `  - ${x}`).join("\n")}

rules:
${SAAS_RULES.map(([id, text]) => `  - id: ${id}\n    text: ${JSON.stringify(text)}`).join("\n")}

skills:
${s.skills.map((n) => `  - name: ${n}`).join("\n")}

orchestrator:
  verify:
${s.verify.map((c) => `    - ${JSON.stringify(c)}`).join("\n")}
  workers: [claude, codex]
  reviewer: codex
${riskYaml}

${MCP_SERVERS}`;
}

export function init(options: { cwd?: string; force?: boolean; saas?: boolean } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const target = path.join(cwd, "agent.config.yaml");
  if (existsSync(target) && !options.force) {
    throw new Error(`${target} already exists. Use --force to overwrite.`);
  }
  if (!options.saas) {
    writeFileSync(target, TEMPLATE);
    console.log(`✓ Created ${target}\nNext: edit it, then run "agentos install"`);
    return;
  }
  const detected = detectStack(cwd);
  writeFileSync(target, saasTemplate(detected));
  const decisions = path.join(cwd, "docs", "decisions", "README.md");
  if (!existsSync(decisions)) {
    mkdirSync(path.dirname(decisions), { recursive: true });
    writeFileSync(decisions, DECISIONS_README);
  }
  console.log(`✓ Detected ${detected.kind} stack (${detected.stack.join(", ")})`);
  console.log(`✓ Created ${target}\nNext: edit it, then run "agentos install"`);
}
