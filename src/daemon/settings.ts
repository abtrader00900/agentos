import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { agentosHome } from "../ui/projects.js";

/** Machine-wide daemon limits, from the optional ~/.agentos/daemon.yaml. */
export const settingsSchema = z
  .object({
    maxRunsPerDay: z.number().int().min(1).max(100).default(6),
    maxCiFixesPerPr: z.number().int().min(0).max(10).default(2),
    tickSeconds: z.number().int().min(5).max(3600).default(30),
    ciEverySeconds: z.number().int().min(30).max(86_400).default(300),
    pauseMinutesOnLimit: z.number().int().min(1).max(1440).default(30),
  })
  .strict();
export type DaemonSettings = z.infer<typeof settingsSchema>;

export function loadSettings(home = agentosHome()): DaemonSettings {
  const file = path.join(home, ".agentos", "daemon.yaml");
  if (!existsSync(file)) return settingsSchema.parse({});
  const r = settingsSchema.safeParse(parse(readFileSync(file, "utf8")) ?? {});
  if (!r.success) throw new Error(`${file}: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  return r.data;
}
