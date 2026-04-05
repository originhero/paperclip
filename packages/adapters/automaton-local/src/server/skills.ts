import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Returns the skills directory from config, falling back to ~/.automaton/skills.
 */
export function resolveSkillsDir(config: Record<string, unknown>): string {
  const configured = asString(config.skillsDir);
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".automaton", "skills");
}

/**
 * Parse YAML frontmatter from a SKILL.md file content.
 * Handles the block between leading `---` delimiters.
 * Extracts: name, description, auto-activate.
 */
export function parseSkillFrontmatter(content: string): {
  name: string | null;
  description: string | null;
  autoActivate: boolean;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: null, description: null, autoActivate: false };
  }

  const frontmatter = match[1];

  const nameMatch = frontmatter.match(/^name\s*:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description\s*:\s*(.+)$/m);
  const autoActivateMatch = frontmatter.match(/^auto-activate\s*:\s*(.+)$/m);

  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, "") : null;
  const description = descriptionMatch
    ? descriptionMatch[1].trim().replace(/^["']|["']$/g, "")
    : null;
  const autoActivateRaw = autoActivateMatch
    ? autoActivateMatch[1].trim().toLowerCase()
    : "false";
  const autoActivate = autoActivateRaw === "true" || autoActivateRaw === "yes" || autoActivateRaw === "1";

  return { name, description, autoActivate };
}

interface DiscoveredSkill {
  key: string;
  runtimeName: string;
  sourcePath: string;
  name: string | null;
  description: string | null;
  autoActivate: boolean;
}

/**
 * Scan a skills directory for subdirectories containing a SKILL.md file.
 * Returns discovered skill metadata.
 */
export async function discoverSkills(skillsDir: string): Promise<DiscoveredSkill[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    // Directory does not exist or is unreadable — return empty list
    return [];
  }

  const discovered: DiscoveredSkill[] = [];

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry);
    let stat;
    try {
      stat = await fs.stat(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const skillMdPath = path.join(entryPath, "SKILL.md");
    let content: string;
    try {
      content = await fs.readFile(skillMdPath, "utf8");
    } catch {
      // No SKILL.md — skip this directory
      continue;
    }

    const { name, description, autoActivate } = parseSkillFrontmatter(content);
    discovered.push({
      key: entry,
      runtimeName: entry,
      sourcePath: entryPath,
      name,
      description,
      autoActivate,
    });
  }

  discovered.sort((a, b) => a.key.localeCompare(b.key));
  return discovered;
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

async function buildSkillSnapshot(
  ctx: AdapterSkillContext,
  desiredSkills: string[] | null,
): Promise<AdapterSkillSnapshot> {
  const skillsDir = resolveSkillsDir(ctx.config);
  const discovered = await discoverSkills(skillsDir);

  // When desiredSkills is null (listSkills), treat auto-activate skills as desired
  const autoActivateKeys = new Set(
    discovered.filter((s) => s.autoActivate).map((s) => s.key),
  );

  const desiredSet: Set<string> =
    desiredSkills !== null
      ? new Set(desiredSkills)
      : autoActivateKeys;

  const resolvedDesiredSkills =
    desiredSkills !== null ? desiredSkills : Array.from(autoActivateKeys).sort();

  const discoveredKeys = new Set(discovered.map((s) => s.key));
  const entries: AdapterSkillEntry[] = [];
  const warnings: string[] = [];

  // Entries from discovered skills
  for (const skill of discovered) {
    const desired = desiredSet.has(skill.key);
    entries.push({
      key: skill.key,
      runtimeName: skill.runtimeName,
      desired,
      managed: false,
      state: "installed",
      origin: "user_installed",
      originLabel: "User-installed",
      locationLabel: skillsDir,
      readOnly: false,
      sourcePath: skill.sourcePath,
      targetPath: null,
      detail: skill.description ?? (skill.name ?? null),
    });
  }

  // Warn about desired skills not found in the skills directory
  if (desiredSkills !== null) {
    for (const key of desiredSkills) {
      if (discoveredKeys.has(key)) continue;
      warnings.push(
        `Desired skill "${key}" was not found in the skills directory (${skillsDir}).`,
      );
      entries.push({
        key,
        runtimeName: null,
        desired: true,
        managed: false,
        state: "missing",
        origin: "external_unknown",
        originLabel: "Unknown",
        locationLabel: skillsDir,
        readOnly: false,
        sourcePath: null,
        targetPath: null,
        detail: `Skill directory "${key}" not found in ${skillsDir}.`,
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    supported: true,
    mode: "persistent",
    desiredSkills: resolvedDesiredSkills,
    entries,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List skills installed in the automaton skills directory.
 * Skills are identified by subdirectories containing a SKILL.md file.
 */
export async function listSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildSkillSnapshot(ctx, null);
}

/**
 * List skills and mark entries as desired/not-desired based on the desiredSkills array.
 */
export async function syncSkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildSkillSnapshot(ctx, desiredSkills);
}
