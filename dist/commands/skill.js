import { existsSync } from "node:fs";
import path from "node:path";
import { listSkills, testSkills, installSkill, bundledSkillsRoot } from "../core/skills.js";
import { installSkillsFromDir, installSkillsFromGit, looksLikeGitSource, looksLikeLocalPath, searchSkills, resolveRegistryEntry } from "../core/registry.js";
export function skillListData(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const bundled = listSkills(bundledSkillsRoot());
    const installedRoot = path.join(cwd, ".agentos", "skills");
    const installed = existsSync(installedRoot) ? new Set(listSkills(installedRoot).map((s) => s.name)) : new Set();
    return bundled.map((s) => ({ name: s.name, description: s.description, installed: installed.has(s.name) }));
}
export function skillList(options = {}) {
    const data = skillListData(options);
    if (options.json) {
        const out = JSON.stringify(data, null, 2);
        console.log(out);
        return out;
    }
    const lines = ["Bundled skills:", ""];
    for (const s of data) {
        lines.push(`  ${s.installed ? "✓ installed" : " "} ${s.name}`);
        lines.push(`      ${s.description.slice(0, 90)}`);
    }
    const out = lines.join("\n");
    console.log(out);
    return out;
}
export async function skillInstall(name, options = {}) {
    const cwd = options.cwd ?? process.cwd();
    // an explicit path is a local skill directory, never something to clone
    const local = path.resolve(cwd, name);
    if (looksLikeLocalPath(name) || ((name.includes("/") || name.includes("\\")) && existsSync(local))) {
        if (!existsSync(local))
            throw new Error(`No such skill directory: ${name}`);
        for (const n of installSkillsFromDir(local, cwd, name))
            console.log(`✓ Installed skill '${n}' → .agentos/skills/${n}`);
        return;
    }
    if (looksLikeGitSource(name)) {
        const installed = installSkillsFromGit(name, cwd);
        for (const n of installed)
            console.log(`✓ Installed skill '${n}' → .agentos/skills/${n}`);
        return;
    }
    if (existsSync(path.join(bundledSkillsRoot(), name))) {
        installSkill(bundledSkillsRoot(), cwd, name);
        console.log(`✓ Installed skill '${name}' → .agentos/skills/${name}`);
        return;
    }
    // not bundled: resolve through the configured registry (repo + path)
    const entry = await resolveRegistryEntry(name, cwd);
    if (entry?.repo) {
        const source = entry.path ? `${entry.repo}#${entry.path}` : entry.repo;
        // the user asked for ONE skill: a repo without `path` may hold many
        const installed = installSkillsFromGit(source, cwd, name);
        for (const n of installed)
            console.log(`✓ Installed skill '${n}' from ${entry.repo} → .agentos/skills/${n}`);
        return;
    }
    throw new Error(entry
        ? `Skill '${name}' is in the registry but its entry has no "repo" to install from.`
        : `Skill '${name}' is not bundled and not in the configured registry.\n` +
            `Try: agentos skill search ${name}  |  agentos skill install <owner/repo[#dir]> | <git-url>`);
}
export async function skillSearch(query, options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const results = await searchSkills(query, cwd);
    if (!results.length) {
        console.log(`No skills matching '${query}'.`);
        console.log("Contribute one: https://github.com/abtrader00900/agentos/tree/master/skills");
        return;
    }
    for (const r of results) {
        const tag = r.origin === "bundled" ? "bundled" : `${r.repo ?? "registry"}${r.path ? "#" + r.path : ""}`;
        console.log(`  ${r.name}
      [${tag}] ${r.description.slice(0, 100)}`);
    }
    console.log(`\n${results.length} match(es). Install: agentos skill install <name> | <owner/repo[#dir]> | <git-url>`);
}
export function skillTest(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    // bundled skills, plus whatever this project installed (community skills included);
    // installed copies ship without their test/ dir, so that check is skipped for them
    const installedRoot = path.join(cwd, ".agentos", "skills");
    const results = [
        ...testSkills(bundledSkillsRoot()),
        ...(existsSync(installedRoot) ? testSkills(installedRoot, { requireTest: false }).map((r) => ({ ...r, skill: `${r.skill} (installed)` })) : []),
    ];
    let failed = 0;
    for (const r of results) {
        if (r.ok) {
            console.log(`  ✓ ${r.skill}`);
        }
        else {
            failed++;
            console.log(`  ✗ ${r.skill}`);
            for (const i of r.issues)
                console.log(`      - ${i}`);
        }
    }
    console.log(`\n${results.length - failed}/${results.length} skills valid`);
    if (failed)
        process.exit(1);
}
//# sourceMappingURL=skill.js.map