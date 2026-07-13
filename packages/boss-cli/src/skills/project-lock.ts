import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { readJsonFile, writeJsonFile } from '../infrastructure/fs.js';

// Project-level lockfile, compatible in spirit with the `npx skills` CLI:
// skills-lock.json at the project root records where each skill came from.

export const LOCAL_LOCK_FILE = 'skills-lock.json';

export interface LocalLockEntry {
  source: string;
  sourceType: 'git' | 'local';
  ref?: string;
  commit?: string;
  version?: string;
  installedAt: string;
  /** project-relative skills dirs this skill was copied into */
  dirs: string[];
}

export interface LocalLock {
  version: 1;
  skills: Record<string, LocalLockEntry>;
}

export function localLockPath(cwd: string): string {
  return path.join(cwd, LOCAL_LOCK_FILE);
}

export function readLocalLock(cwd: string): LocalLock {
  const file = localLockPath(cwd);
  if (!fs.existsSync(file)) {
    return { version: 1, skills: {} };
  }
  try {
    const parsed = readJsonFile<LocalLock>(file);
    if (!parsed.skills || typeof parsed.skills !== 'object') return { version: 1, skills: {} };
    return { version: 1, skills: parsed.skills };
  } catch {
    return { version: 1, skills: {} };
  }
}

export function writeLocalLock(cwd: string, lock: LocalLock): void {
  writeJsonFile(localLockPath(cwd), lock);
}

// Remember the last interactive agent selection, like the skills CLI does.
const LAST_AGENTS_FILE = path.join(os.homedir(), '.boss', 'last-selected-agents.json');

export function getLastSelectedAgents(): string[] {
  try {
    const parsed = readJsonFile<{ agents: string[] }>(LAST_AGENTS_FILE);
    return Array.isArray(parsed.agents) ? parsed.agents : [];
  } catch {
    return [];
  }
}

export function saveSelectedAgents(agents: string[]): void {
  try {
    fs.mkdirSync(path.dirname(LAST_AGENTS_FILE), { recursive: true });
    writeJsonFile(LAST_AGENTS_FILE, { agents });
  } catch {
    // selection memory is best-effort
  }
}
