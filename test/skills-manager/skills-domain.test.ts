import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseSourceSpec } from '../../packages/boss-cli/src/skills/source.js';
import {
  discoverSkills,
  parseSkillFrontmatter,
  sanitizeSkillName
} from '../../packages/boss-cli/src/skills/discover.js';
import {
  findEntry,
  findEntryByTargetPath,
  recordInstall,
  removeTarget,
  type SkillsManifest
} from '../../packages/boss-cli/src/skills/manifest.js';
import {
  AGENT_REGISTRY,
  getNonUniversalAgents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  isUniversalAgent,
  UNIVERSAL_SKILLS_DIR
} from '../../packages/boss-cli/src/skills/agent-registry.js';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-skills-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseSourceSpec', () => {
  it('resolves owner/repo shorthand to a GitHub URL', () => {
    expect(parseSourceSpec('mattpocock/skills')).toEqual({
      source: 'https://github.com/mattpocock/skills.git',
      kind: 'git',
      ref: undefined
    });
  });

  it('extracts @ref pins from shorthand and URLs', () => {
    expect(parseSourceSpec('mattpocock/skills@v1.2.3')).toMatchObject({
      source: 'https://github.com/mattpocock/skills.git',
      ref: 'v1.2.3'
    });
    expect(parseSourceSpec('https://github.com/a/b.git@main')).toMatchObject({
      source: 'https://github.com/a/b.git',
      ref: 'main'
    });
  });

  it('does not treat the user part of ssh URLs as a ref', () => {
    expect(parseSourceSpec('git@github.com:owner/repo')).toEqual({
      source: 'git@github.com:owner/repo',
      kind: 'git',
      ref: undefined
    });
  });

  it('prefers an existing local directory over ref parsing', () => {
    const dir = makeTmpDir();
    const withAt = path.join(dir, 'skill@v1');
    fs.mkdirSync(withAt);
    expect(parseSourceSpec(withAt)).toEqual({ source: withAt, kind: 'local' });
  });

  it('rejects unrecognized sources', () => {
    expect(() => parseSourceSpec('definitely not a source')).toThrowError(/Unrecognized source/);
    expect(() => parseSourceSpec('   ')).toThrowError(/empty/);
  });
});

describe('parseSkillFrontmatter / sanitizeSkillName', () => {
  it('parses name, description and version', () => {
    const fm = parseSkillFrontmatter('---\nname: my-skill\ndescription: "Does things"\nversion: 1.2.3\n---\nbody');
    expect(fm).toEqual({ name: 'my-skill', description: 'Does things', version: '1.2.3' });
  });

  it('returns empty object without frontmatter', () => {
    expect(parseSkillFrontmatter('# just markdown')).toEqual({});
  });

  it('sanitizes traversal attempts in names', () => {
    expect(sanitizeSkillName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeSkillName('nice_name-1.0')).toBe('nice_name-1.0');
    expect(sanitizeSkillName('...')).toBe('');
  });
});

describe('discoverSkills', () => {
  it('finds SKILL.md directories recursively and stops at skill boundaries', () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'skills', 'alpha'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'alpha', 'nested-child'), { recursive: true });
    fs.mkdirSync(path.join(root, 'beta'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\n');
    fs.writeFileSync(
      path.join(root, 'skills', 'alpha', 'nested-child', 'SKILL.md'),
      '---\nname: nested\ndescription: N\n---\n'
    );
    fs.writeFileSync(path.join(root, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: B\n---\n');
    fs.writeFileSync(path.join(root, 'node_modules', 'junk', 'SKILL.md'), '---\nname: junk\n---\n');

    const names = discoverSkills(root).map((skill) => skill.name);
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('falls back to the directory basename when frontmatter has no name', () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'fallback-skill'));
    fs.writeFileSync(path.join(root, 'fallback-skill', 'SKILL.md'), 'no frontmatter');
    expect(discoverSkills(root).map((skill) => skill.name)).toEqual(['fallback-skill']);
  });
});

describe('agent registry', () => {
  it('ports the full skills-cli registry (73 agents)', () => {
    expect(AGENT_REGISTRY.length).toBe(73);
    const ids = AGENT_REGISTRY.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('groups universal agents by the shared .agents/skills dir', () => {
    const universal = getUniversalAgents();
    expect(universal.every((agent) => agent.skillsDir === UNIVERSAL_SKILLS_DIR)).toBe(true);
    expect(universal.map((agent) => agent.id)).toContain('codex');
    expect(universal.map((agent) => agent.id)).toContain('cursor');
    // visible subset excludes showInUniversalPrompt: false entries
    expect(getVisibleUniversalAgents().length).toBeLessThan(universal.length);
    // non-universal agents own their project dirs
    expect(getNonUniversalAgents().every((agent) => !isUniversalAgent(agent))).toBe(true);
    expect(getNonUniversalAgents().map((agent) => agent.id)).toContain('continue');
  });
});

describe('manifest operations', () => {
  const entry = {
    name: 'code-review',
    source: 'https://github.com/a/b.git',
    kind: 'git' as const,
    ref: undefined,
    commit: 'abc1234',
    description: 'review',
    version: '1.0.0'
  };

  it('records installs keyed by (name, source) and steals paths from previous owners', () => {
    const manifest: SkillsManifest = { version: 1, skills: [] };
    recordInstall(manifest, entry, { agent: 'codex', path: '/x/codex/code-review' });
    recordInstall(manifest, entry, { agent: 'claude-code', path: '/x/claude/code-review' });
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills[0]!.targets).toHaveLength(2);

    // same name, different source takes over the codex path
    const rival = { ...entry, source: 'https://github.com/c/d.git' };
    recordInstall(manifest, rival, { agent: 'codex', path: '/x/codex/code-review' });
    expect(manifest.skills).toHaveLength(2);
    expect(findEntry(manifest, 'code-review', entry.source)!.targets).toHaveLength(1);
    expect(findEntryByTargetPath(manifest, '/x/codex/code-review')!.source).toBe(rival.source);
  });

  it('drops entries whose last target is removed', () => {
    const manifest: SkillsManifest = { version: 1, skills: [] };
    recordInstall(manifest, entry, { agent: 'codex', path: '/x/codex/code-review' });
    removeTarget(manifest, manifest.skills[0]!, '/x/codex/code-review');
    expect(manifest.skills).toHaveLength(0);
  });
});
