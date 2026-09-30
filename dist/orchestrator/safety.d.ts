/** Kinds of secret patterns found in text (no file/.env logic). */
export declare const secretHits: (text: string) => string[];
/** Replace every secret-pattern match with *** */
export declare function maskSecrets(text: string): string;
/** Secrets in the lines a diff adds, and any .env file it adds or changes. */
export declare function scanDiff(diff: string): string[];
/**
 * Replace the values of secret-looking environment variables (values shorter than 6 are left) and every
 * secret-pattern match (a token a test or an agent printed) with ***.
 */
export declare function redact(text: string, env?: NodeJS.ProcessEnv): string;
