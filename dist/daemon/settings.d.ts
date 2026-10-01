import { z } from "zod";
/** Machine-wide daemon limits, from the optional ~/.agentos/daemon.yaml. */
export declare const settingsSchema: z.ZodObject<{
    maxRunsPerDay: z.ZodDefault<z.ZodNumber>;
    maxCiFixesPerPr: z.ZodDefault<z.ZodNumber>;
    tickSeconds: z.ZodDefault<z.ZodNumber>;
    ciEverySeconds: z.ZodDefault<z.ZodNumber>;
    pauseMinutesOnLimit: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    maxRunsPerDay: number;
    maxCiFixesPerPr: number;
    tickSeconds: number;
    ciEverySeconds: number;
    pauseMinutesOnLimit: number;
}, {
    maxRunsPerDay?: number | undefined;
    maxCiFixesPerPr?: number | undefined;
    tickSeconds?: number | undefined;
    ciEverySeconds?: number | undefined;
    pauseMinutesOnLimit?: number | undefined;
}>;
export type DaemonSettings = z.infer<typeof settingsSchema>;
export declare function loadSettings(home?: string): DaemonSettings;
