// Variant — NOT what agentos 0.2.0 generates: the base target plus one rule that tells the agent to check
// memory first. Measures whether a sharper instruction makes the seeded memory pay off, and what it costs
// on the tasks that don't need it. Run with --arms agentos (the baseline arm is identical to the base target's).
import base from "./agentos.mjs";

const rule =
  "  - id: memory-first\n" +
  "    text: Before answering a question about why this project does something, or about its conventions and setup, call memory_recall to check the stored project facts.\n";

if (!base.agentos.config.includes("\n\nmcpServers:")) throw new Error("base config layout changed");

export default {
  ...base,
  name: "agentos-memrule",
  agentos: { ...base.agentos, config: base.agentos.config.replace("\n\nmcpServers:", `\n${rule}\nmcpServers:`) },
};
