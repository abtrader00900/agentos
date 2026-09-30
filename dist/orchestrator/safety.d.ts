/** Secrets in the lines a diff adds, and any .env file it adds or changes. */
export declare function scanDiff(diff: string): string[];
/** Replace the values of secret-looking environment variables with *** (values shorter than 6 are left). */
export declare function redact(text: string, env?: NodeJS.ProcessEnv): string;
