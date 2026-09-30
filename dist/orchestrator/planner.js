import { validatePlan } from "./plan.js";
import { finalText } from "./runners.js";
export function plannerPrompt(input) {
    return [
        "You are the planner for a team of coding agents. Do not edit any files; read whatever you need.",
        `Task: ${input.task}`,
        input.facts.length ? `Project memory:\n${input.facts.map((f) => `- ${f}`).join("\n")}` : "",
        `Files in the repository (first ${input.files.length}):\n${input.files.join("\n")}`,
        [
            `Split the task into 1-8 subtasks for these agents: ${input.workers.join(", ")}.`,
            "A small task is ONE subtask. Split only when parts are truly independent.",
            "Subtasks that run in parallel must change different files; if two subtasks touch the same file, chain them with dependsOn.",
            "Each prompt must stand alone: a worker sees only its prompt and the plan summary.",
            "Workers edit files only; agentos commits and runs the tests.",
        ].join("\n"),
        'Reply with ONLY this JSON: {"summary":"...","subtasks":[{"id":"kebab-id","title":"...","prompt":"...","files":["path"],"dependsOn":[],"agent":"claude"}]}',
    ]
        .filter(Boolean)
        .join("\n\n");
}
/** the JSON object in an agent's reply: first "{" to last "}" */
export function extractJson(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start)
        throw new Error("no JSON object in the planner's reply");
    return JSON.parse(text.slice(start, end + 1));
}
/** Ask for a plan; one retry that quotes the validation error. */
export async function makePlan(runner, input, cwd, timeoutMs) {
    let prompt = plannerPrompt(input);
    let error = "";
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await runner({ prompt, cwd, timeoutMs });
        if (res.rateLimited)
            return { rateLimited: true };
        if (!res.ok) {
            error = `the planner failed${res.timedOut ? " (timeout)" : ""}: ${res.output.slice(-500)}`;
            continue;
        }
        try {
            const v = validatePlan(extractJson(finalText(res.output)), input.workers);
            if (v.plan)
                return { plan: v.plan };
            error = v.error;
        }
        catch (e) {
            error = e.message;
        }
        prompt = `${plannerPrompt(input)}\n\nYour previous plan was rejected: ${error}\nReturn the corrected JSON only.`;
    }
    return { error };
}
//# sourceMappingURL=planner.js.map