/**
 * FR-6.x: skills framework.
 * Skill format: SKILL.md (required) with YAML frontmatter (name, description),
 * optional scripts/, required test/ (validated via the skill linter).
 * Skills are harness-agnostic markdown consumed by any agent.
 */
export interface SkillMeta {
    name: string;
    description: string;
    dir: string;
}
export interface SkillValidation {
    skill: string;
    ok: boolean;
    issues: string[];
}
export declare function parseSkill(skillMd: string): {
    name?: string;
    description?: string;
    body: string;
};
export interface ValidateOptions {
    /** the name the skill will be installed under (default: its directory name) */
    name?: string;
    /** installed copies ship without their contract test (it would run in the user's own test suite) */
    requireTest?: boolean;
}
export declare function validateSkillDir(skillDir: string, opts?: ValidateOptions): SkillValidation;
/**
 * Copy a validated skill into the project. Its test/ directory stays behind:
 * .agentos/skills/<name>/test/skill.test.mjs imports vitest and would be picked
 * up by the user's own `vitest` run (the default include matches it).
 */
export declare function copySkill(src: string, dst: string): void;
export declare function listSkills(skillsRoot: string): SkillMeta[];
export declare function testSkills(skillsRoot: string, opts?: Omit<ValidateOptions, "name">): SkillValidation[];
/** FR-6.4: install a bundled skill into a project's .agentos/skills/ */
export declare function installSkill(bundledRoot: string, projectDir: string, name: string): void;
export declare function bundledSkillsRoot(): string;
