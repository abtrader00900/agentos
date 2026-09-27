// Template for a local-only target, e.g. a private repo. Copy it OUTSIDE this repo, fill it in, then:
//   BENCH_TARGET=/abs/path/my-target.mjs node bench/run.mjs --label pilot
// `private: true` writes results to bench/results/local/ (gitignored). Never commit private code, tasks or answers.
export default {
  name: "my-app",
  private: true,
  // each run gets a fresh copy of the files committed at `ref`
  source: { repo: "/abs/path/to/repo", ref: "HEAD" },
  // big dependency dirs: copied once per invocation, then linked into every copy (tests need them)
  links: { vendor: "/abs/path/to/repo/vendor" },

  agentos: {
    config: `project:
  name: my-app
  description: "Laravel ERP"
stack: [laravel]
rules:
  - id: run-tests-first
    text: Before marking any task done, run the project test suite and paste results.
  - id: no-guessing-deps
    text: Use the codegraph/supersearch MCP tools to verify dependencies instead of guessing imports.
mcpServers:
  - name: memory
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "memory"]
  - name: supersearch
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "supersearch"]
  - name: codegraph
    command: npx
    args: ["-y", "@basit0090/agent-os", "mcp", "codegraph"]
`,
    // facts the project's memory would already hold
    memory: [{ topic: "architecture", key: "example", value: "…", source: "…" }],
  },

  // every task needs an automatic check; a cheap wrong answer is a failure
  tasks: [
    { id: "overhead", prompt: "Reply with the single word OK.", check: ({ answer }) => ({ pass: /\bOK\b/.test(answer), detail: null }) },
    // {
    //   id: "impact",
    //   prompt: "If I change app/Models/Invoice.php, which files could break? End with one line `FILES: a, b, ...`.",
    //   check: ({ answer }) => { const need = ["app/Http/Controllers/InvoiceController.php"];
    //     const missing = need.filter((f) => !answer.replace(/\\/g, "/").includes(f)); return { pass: !missing.length, detail: { missing } }; },
    // },
    // setup(dir) may break something first (a "fix" task); check({ dir, extract }) can re-extract hidden
    // tests with extract(["tests"]) and run them in dir.
  ],
};
