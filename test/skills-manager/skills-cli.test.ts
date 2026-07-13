import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureBuilt } from '../helpers/run-cli.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BOSS_BIN = path.join(REPO_ROOT, 'packages', 'boss-cli', 'dist', 'bin', 'boss.js');

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-skills-cli-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runBoss(args: string[], home: string, cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BOSS_BIN, ...args], {
    encoding: 'utf8',
    cwd: cwd ?? home,
    env: { ...process.env, HOME: home, CODEX_HOME: '', CLAUDE_CONFIG_DIR: '', XDG_CONFIG_HOME: '' }
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function makeSkillSource(): string {
  const src = makeTmpDir();
  fs.mkdirSync(path.join(src, 'skills', 'code-review'), { recursive: true });
  fs.mkdirSync(path.join(src, 'skills', 'to-spec'), { recursive: true });
  fs.writeFileSync(
    path.join(src, 'skills', 'code-review', 'SKILL.md'),
    '---\nname: code-review\ndescription: Review code\nversion: 1.0.0\n---\nbody\n'
  );
  fs.writeFileSync(
    path.join(src, 'skills', 'to-spec', 'SKILL.md'),
    '---\nname: to-spec\ndescription: Plan to spec\n---\nbody\n'
  );
  return src;
}

describe('boss skills CLI (headless)', () => {
  beforeAll(() => {
    ensureBuilt('packages/boss-cli/dist/bin/boss.js');
  });

  it('installs project-locally: detected universal agents collapse into .agents/skills', () => {
    const home = makeTmpDir();
    fs.mkdirSync(path.join(home, '.codex'));
    fs.mkdirSync(path.join(home, '.cursor'));
    const project = makeTmpDir();
    const src = makeSkillSource();

    const add = runBoss(['skills', 'add', src, '--yes'], home, project);
    expect(add.status).toBe(0);
    expect(JSON.parse(add.stdout).status).toBe('ok');

    // codex + cursor are both universal → one copy in .agents/skills, nothing in HOME
    expect(fs.existsSync(path.join(project, '.agents', 'skills', 'code-review', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.agents', 'skills', 'to-spec', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.codex', 'skills'))).toBe(false);

    const lock = JSON.parse(fs.readFileSync(path.join(project, 'skills-lock.json'), 'utf8'));
    expect(Object.keys(lock.skills).sort()).toEqual(['code-review', 'to-spec']);
    expect(lock.skills['code-review'].dirs).toEqual(['.agents/skills']);
  });

  it('installs non-universal agents into their own project dirs', () => {
    const home = makeTmpDir();
    const project = makeTmpDir();
    const src = makeSkillSource();

    const add = runBoss(['skills', 'add', src, '--yes', '--agents', 'continue,claude-code'], home, project);
    expect(add.status).toBe(0);
    expect(fs.existsSync(path.join(project, '.continue', 'skills', 'code-review', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.claude', 'skills', 'code-review', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.agents'))).toBe(false);
  });

  it('honors --skills filter and reports unknown skills', () => {
    const home = makeTmpDir();
    const project = makeTmpDir();
    const src = makeSkillSource();

    const add = runBoss(['skills', 'add', src, '--yes', '--skills', 'code-review', '--agents', 'continue'], home, project);
    expect(add.status).toBe(0);
    expect(fs.existsSync(path.join(project, '.continue', 'skills', 'code-review'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.continue', 'skills', 'to-spec'))).toBe(false);

    const bad = runBoss(['skills', 'add', src, '--yes', '--skills', 'nope', '--agents', 'continue'], home, project);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr + bad.stdout).toContain('unknown_skill');
  });

  it('supports dry-run without writing anything', () => {
    const home = makeTmpDir();
    fs.mkdirSync(path.join(home, '.codex'));
    const project = makeTmpDir();
    const src = makeSkillSource();

    const dryRun = runBoss(['skills', 'add', src, '--dry-run'], home, project);
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout).actions.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(project, '.agents'))).toBe(false);
    expect(fs.existsSync(path.join(project, 'skills-lock.json'))).toBe(false);
  });

  it('lists, updates and removes project skills via the lockfile', () => {
    const home = makeTmpDir();
    const project = makeTmpDir();
    const src = makeSkillSource();
    expect(runBoss(['skills', 'add', src, '--yes', '--agents', 'continue'], home, project).status).toBe(0);

    const list = runBoss(['skills', 'list'], home, project);
    expect(list.status).toBe(0);
    expect(Object.keys(JSON.parse(list.stdout).skills).sort()).toEqual(['code-review', 'to-spec']);

    fs.writeFileSync(
      path.join(src, 'skills', 'code-review', 'SKILL.md'),
      '---\nname: code-review\ndescription: Review code\nversion: 2.0.0\n---\nbody v2\n'
    );
    const update = runBoss(['skills', 'update', 'code-review'], home, project);
    expect(update.status).toBe(0);
    expect(fs.readFileSync(path.join(project, '.continue', 'skills', 'code-review', 'SKILL.md'), 'utf8')).toContain(
      'version: 2.0.0'
    );

    const unconfirmed = runBoss(['skills', 'remove', 'to-spec'], home, project);
    expect(unconfirmed.status).not.toBe(0);

    const removed = runBoss(['skills', 'remove', 'to-spec', '--yes'], home, project);
    expect(removed.status).toBe(0);
    expect(fs.existsSync(path.join(project, '.continue', 'skills', 'to-spec'))).toBe(false);
    const lock = JSON.parse(fs.readFileSync(path.join(project, 'skills-lock.json'), 'utf8'));
    expect(Object.keys(lock.skills)).toEqual(['code-review']);
  });

  it('installs to agent home directories with --global and tracks the manifest', () => {
    const home = makeTmpDir();
    fs.mkdirSync(path.join(home, '.codex'));
    const project = makeTmpDir();
    const src = makeSkillSource();

    const add = runBoss(['skills', 'add', src, '--yes', '--global', '--agents', 'codex,claude-code'], home, project);
    expect(add.status).toBe(0);
    expect(fs.existsSync(path.join(home, '.codex', 'skills', 'code-review', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.claude', 'skills', 'code-review', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'skills-lock.json'))).toBe(false);

    const manifest = JSON.parse(fs.readFileSync(path.join(home, '.boss', 'installed.json'), 'utf8'));
    expect(manifest.skills.length).toBeGreaterThan(0);

    const removed = runBoss(['skills', 'remove', 'to-spec', '--yes', '--global'], home, project);
    expect(removed.status).toBe(0);
    expect(fs.existsSync(path.join(home, '.codex', 'skills', 'to-spec'))).toBe(false);
  });

  it('fails clearly for unknown agents', () => {
    const home = makeTmpDir();
    const project = makeTmpDir();
    const src = makeSkillSource();
    const badAgent = runBoss(['skills', 'add', src, '--yes', '--agents', 'nope'], home, project);
    expect(badAgent.status).not.toBe(0);
    expect(badAgent.stderr + badAgent.stdout).toContain('unknown_agent');
  });

  it('keeps non-interactive bare install behavior unchanged', () => {
    const home = makeTmpDir();
    fs.mkdirSync(path.join(home, '.codex'));
    const install = runBoss(['install', '--human'], home);
    expect(install.status).toBe(0);
    expect(fs.existsSync(path.join(home, '.codex', 'skills', 'boss', 'SKILL.md'))).toBe(true);
  });
});
