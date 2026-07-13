import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { readJsonFile, writeJsonFile } from '../infrastructure/fs.js';

export interface ManifestTarget {
  agent: string;
  path: string;
}

export interface ManifestEntry {
  name: string;
  source: string;
  kind: 'git' | 'local';
  ref?: string;
  commit?: string;
  description?: string;
  version?: string;
  installedAt: string;
  targets: ManifestTarget[];
}

export interface SkillsManifest {
  version: 1;
  skills: ManifestEntry[];
}

export function manifestPath(): string {
  return path.join(os.homedir(), '.boss', 'installed.json');
}

export function readManifest(): SkillsManifest {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return { version: 1, skills: [] };
  }
  try {
    const parsed = readJsonFile<SkillsManifest>(file);
    if (!Array.isArray(parsed.skills)) return { version: 1, skills: [] };
    return { version: 1, skills: parsed.skills };
  } catch {
    return { version: 1, skills: [] };
  }
}

export function writeManifest(manifest: SkillsManifest): void {
  const file = manifestPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonFile(file, manifest);
}

/** Entries are keyed by (name, source); the same skill name from another source is a distinct entry. */
export function findEntry(manifest: SkillsManifest, name: string, source: string): ManifestEntry | undefined {
  return manifest.skills.find((entry) => entry.name === name && entry.source === source);
}

export function findEntriesByName(manifest: SkillsManifest, name: string): ManifestEntry[] {
  return manifest.skills.filter((entry) => entry.name === name);
}

/** Which entry (if any) currently owns an installed path, regardless of skill name. */
export function findEntryByTargetPath(manifest: SkillsManifest, targetPath: string): ManifestEntry | undefined {
  return manifest.skills.find((entry) => entry.targets.some((target) => target.path === targetPath));
}

export function recordInstall(
  manifest: SkillsManifest,
  entry: Omit<ManifestEntry, 'targets' | 'installedAt'>,
  target: ManifestTarget
): void {
  // A path can only be owned by one entry — steal it from any previous owner.
  for (const existing of manifest.skills) {
    existing.targets = existing.targets.filter((t) => t.path !== target.path);
  }

  let owner = findEntry(manifest, entry.name, entry.source);
  if (!owner) {
    owner = { ...entry, installedAt: new Date().toISOString(), targets: [] };
    manifest.skills.push(owner);
  } else {
    owner.ref = entry.ref;
    owner.commit = entry.commit;
    owner.description = entry.description;
    owner.version = entry.version;
    owner.installedAt = new Date().toISOString();
  }
  owner.targets.push(target);

  manifest.skills = manifest.skills.filter((e) => e.targets.length > 0);
}

export function removeTarget(manifest: SkillsManifest, entry: ManifestEntry, targetPath: string): void {
  entry.targets = entry.targets.filter((target) => target.path !== targetPath);
  manifest.skills = manifest.skills.filter((e) => e.targets.length > 0);
}
