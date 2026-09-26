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
export declare function validateSkillDir(skillDir: string): SkillValidation;
export declare function listSkills(skillsRoot: string): SkillMeta[];
export declare function testSkills(skillsRoot: string): SkillValidation[];
/** FR-6.4: install a bundled skill into a project's .agentos/skills/ */
export declare function installSkill(bundledRoot: string, projectDir: string, name: string): void;
export declare function bundledSkillsRoot(): string;
