import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const TEMPLATE = `# AgentOS project config — single source of truth for all agent harnesses.
# Docs: https://github.com/yourname/agentos

project:
  name: my-project
  description: ""

stack:
  - typescript

rules:
  - id: run-tests-first
    text: Before marking any task done, run the project test suite and paste results.
  - id: no-guessing-deps
    text: Use the codegraph/supersearch MCP tools to verify dependencies instead of guessing imports.

skills:
  - name: tdd-laravel   # remove if not a Laravel project

mcpServers:
  - name: memory
    command: npx
    args: ["-y", "agentos", "mcp", "memory"]
`;

export function init(options: { cwd?: string; force?: boolean } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const target = path.join(cwd, "agent.config.yaml");
  if (existsSync(target) && !options.force) {
    throw new Error(`${target} already exists. Use --force to overwrite.`);
  }
  writeFileSync(target, TEMPLATE);
  console.log(`✓ Created ${target}\nNext: edit it, then run "agentos install"`);
}
