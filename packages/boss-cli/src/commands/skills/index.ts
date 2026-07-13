#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

import { cancel, confirm, intro, isCancel, log, multiselect, outro, spinner } from '@clack/prompts';

import type { CliContext } from '../../cli/contract.js';
import { assertConfirmed, CliUserError, createCliContext, writeOutput } from '../../cli/contract.js';
import { SKILLS_USAGE } from '../../cli/help.js';
import {
  AGENT_REGISTRY,
  detectInstalledAgents,
  findRegistryAgent,
  getNonUniversalAgents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  isUniversalAgent,
  UNIVERSAL_SKILLS_DIR,
  type RegistryAgent
} from '../../skills/agent-registry.js';
import { printBanner } from '../../skills/banner.js';
import { discoverSkills, type DiscoveredSkill } from '../../skills/discover.js';
import { installSkillToPath, type InstallOutcome } from '../../skills/installer.js';
import {
  findEntriesByName,
  readManifest,
  recordInstall,
  removeTarget,
  writeManifest,
  type ManifestEntry
} from '../../skills/manifest.js';
import {
  getLastSelectedAgents,
  readLocalLock,
  saveSelectedAgents,
  writeLocalLock,
  type LocalLockEntry
} from '../../skills/project-lock.js';
import { PROMPT_CANCELLED, searchMultiselect } from '../../skills/search-multiselect.js';
import { parseSourceSpec, resolveSource, type ResolvedSource, type SourceSpec } from '../../skills/source.js';

const CANCELLED = 130;

interface SkillsFlags {
  argv: string[];
  skillsFilter?: string[];
  agentsFilter?: string[];
  global: boolean;
}

function extractOption(argv: string[], name: string): { argv: string[]; value?: string } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === `--${name}`) {
      value = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith(`--${name}=`)) {
      value = arg.slice(name.length + 3);
      continue;
    }
    rest.push(arg);
  }
  return { argv: rest, value };
}

function extractFlag(argv: string[], ...names: string[]): { argv: string[]; present: boolean } {
  const rest = argv.filter((arg) => !names.includes(arg));
  return { argv: rest, present: rest.length !== argv.length };
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function parseSkillsFlags(argv: string[]): SkillsFlags {
  const skillsOpt = extractOption(argv, 'skills');
  const agentsOpt = extractOption(skillsOpt.argv, 'agents');
  const globalOpt = extractFlag(agentsOpt.argv, '--global', '-g');
  return {
    argv: globalOpt.argv,
    skillsFilter: parseCsv(skillsOpt.value),
    agentsFilter: parseCsv(agentsOpt.value),
    global: globalOpt.present
  };
}

function isInteractive(context: CliContext): boolean {
  return context.stdinIsTTY && context.stdoutIsTTY && !context.useJson && !context.values.yes && !context.values.dryRun;
}

function resolveAgentsOrThrow(ids: string[]): RegistryAgent[] {
  return ids.map((id) => {
    const agent = findRegistryAgent(id);
    if (!agent) {
      throw new CliUserError({
        code: 'unknown_agent',
        message: `Unknown agent: ${id}`,
        input: { agent: id },
        retryable: false,
        suggestion: `Valid agents: ${AGENT_REGISTRY.map((a) => a.id).join(', ')}`
      });
    }
    return agent;
  });
}

/**
 * Map agents to install directories. Project mode uses project-relative
 * skillsDirs (universal agents collapse into .agents/skills); global mode uses
 * each agent's home-level globalSkillsDir. Deduped by absolute path.
 */
function dirsForAgents(
  agents: RegistryAgent[],
  mode: 'project' | 'global',
  cwd: string
): Map<string, { display: string; agents: string[] }> {
  const dirs = new Map<string, { display: string; agents: string[] }>();
  const seen = new Set<string>();
  for (const agent of agents) {
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    let display: string;
    let abs: string;
    if (mode === 'project') {
      display = agent.skillsDir;
      abs = path.join(cwd, agent.skillsDir);
    } else {
      if (!agent.globalSkillsDir) {
        throw new CliUserError({
          code: 'no_global_dir',
          message: `${agent.displayName} does not support global installs`,
          input: { agent: agent.id },
          retryable: false,
          suggestion: 'Install without --global to use the project-level skills directory'
        });
      }
      display = agent.globalSkillsDir;
      abs = agent.globalSkillsDir;
    }
    const existing = dirs.get(abs);
    if (existing) {
      existing.agents.push(agent.id);
    } else {
      dirs.set(abs, { display, agents: [agent.id] });
    }
  }
  return dirs;
}

function discoverSelectedSkills(
  resolved: ResolvedSource,
  skillsFilter: string[] | undefined
): { discovered: DiscoveredSkill[]; selected: DiscoveredSkill[] } {
  const discovered = discoverSkills(resolved.dir);
  if (skillsFilter) {
    const missing = skillsFilter.filter((name) => !discovered.some((skill) => skill.name === name));
    if (missing.length > 0) {
      throw new CliUserError({
        code: 'unknown_skill',
        message: `Skill(s) not found in source: ${missing.join(', ')}`,
        input: { skills: missing },
        retryable: false,
        suggestion: `Available: ${discovered.map((skill) => skill.name).join(', ') || '(none)'}`
      });
    }
  }
  const selected = skillsFilter ? discovered.filter((skill) => skillsFilter.includes(skill.name)) : discovered;
  if (selected.length === 0) {
    throw new CliUserError({
      code: 'no_skills_found',
      message: 'No skills (directories containing SKILL.md) found in this source',
      retryable: false,
      suggestion: 'Check the repository layout or pass a different source'
    });
  }
  return { discovered, selected };
}

function installToDirs(
  skills: DiscoveredSkill[],
  dirs: Map<string, { display: string; agents: string[] }>,
  onResult?: (outcome: InstallOutcome, display: string) => void
): InstallOutcome[] {
  const outcomes: InstallOutcome[] = [];
  for (const skill of skills) {
    for (const [abs, info] of dirs) {
      const outcome = installSkillToPath(skill, info.display, path.join(abs, skill.name));
      outcomes.push(outcome);
      onResult?.(outcome, info.display);
    }
  }
  return outcomes;
}

function recordProjectLock(
  cwd: string,
  skills: DiscoveredSkill[],
  outcomes: InstallOutcome[],
  dirs: Map<string, { display: string; agents: string[] }>,
  spec: SourceSpec,
  commit: string | undefined
): void {
  const lock = readLocalLock(cwd);
  for (const skill of skills) {
    const installedDirs = [...dirs.entries()]
      .filter(([abs]) =>
        outcomes.some(
          (outcome) => outcome.skill === skill.name && outcome.status === 'installed' && outcome.path === path.join(abs, skill.name)
        )
      )
      .map(([, info]) => info.display);
    if (installedDirs.length === 0) continue;
    const previous = lock.skills[skill.name];
    const mergedDirs = [...new Set([...(previous?.dirs ?? []), ...installedDirs])];
    lock.skills[skill.name] = {
      source: spec.source,
      sourceType: spec.kind,
      ref: spec.ref,
      commit,
      version: skill.version,
      installedAt: new Date().toISOString(),
      dirs: mergedDirs
    } satisfies LocalLockEntry;
  }
  writeLocalLock(cwd, lock);
}

function recordGlobalManifest(
  skills: DiscoveredSkill[],
  outcomes: InstallOutcome[],
  dirs: Map<string, { display: string; agents: string[] }>,
  spec: SourceSpec,
  commit: string | undefined
): void {
  const manifest = readManifest();
  for (const skill of skills) {
    for (const [abs, info] of dirs) {
      const dest = path.join(abs, skill.name);
      const installed = outcomes.some(
        (outcome) => outcome.skill === skill.name && outcome.status === 'installed' && outcome.path === dest
      );
      if (!installed) continue;
      recordInstall(
        manifest,
        {
          name: skill.name,
          source: spec.source,
          kind: spec.kind,
          ref: spec.ref,
          commit,
          description: skill.description || undefined,
          version: skill.version
        },
        { agent: info.agents.join(','), path: dest }
      );
    }
  }
  writeManifest(manifest);
}

function reportOutcomes(outcomes: InstallOutcome[], context: CliContext, verb = 'installed'): number {
  const failed = outcomes.filter((outcome) => outcome.status === 'failed');
  if (context.useJson) {
    writeOutput({ results: outcomes, status: failed.length > 0 ? 'partial' : 'ok' }, context, () => '');
  } else {
    for (const outcome of outcomes) {
      if (outcome.status === 'installed') {
        console.log(`  ✅ ${outcome.skill}: ${verb} at ${outcome.path}`);
      } else {
        console.log(`  ❌ ${outcome.skill}: ${outcome.error} (${outcome.path})`);
      }
    }
  }
  return failed.length > 0 ? 1 : 0;
}

async function selectAgentsInteractive(mode: 'project' | 'global'): Promise<RegistryAgent[] | typeof PROMPT_CANCELLED> {
  const supportsMode = (agent: RegistryAgent) => mode === 'project' || Boolean(agent.globalSkillsDir);
  const universalAgents = getUniversalAgents().filter(supportsMode);
  const visibleUniversal = getVisibleUniversalAgents().filter(supportsMode);
  const otherAgents = getNonUniversalAgents().filter((agent) => agent.id !== 'eve' && supportsMode(agent));

  const lastSelected = getLastSelectedAgents();
  const selected = await searchMultiselect({
    message: 'Which agents do you want to install to?',
    items: otherAgents.map((agent) => ({
      value: agent.id,
      label: agent.displayName,
      hint: mode === 'global' ? agent.globalSkillsDir : agent.skillsDir
    })),
    initialSelected: lastSelected.filter((id) => otherAgents.some((agent) => agent.id === id)),
    lockedSection: {
      title: `Universal (${UNIVERSAL_SKILLS_DIR})`,
      items: visibleUniversal.map((agent) => ({ value: agent.id, label: agent.displayName })),
      hiddenCount: universalAgents.length - visibleUniversal.length
    }
  });
  if (selected === PROMPT_CANCELLED) return PROMPT_CANCELLED;

  saveSelectedAgents(selected);
  return [...universalAgents, ...resolveAgentsOrThrow(selected)];
}

async function runAddWizard(sourceArg: string, flags: SkillsFlags, cwd: string): Promise<number> {
  printBanner();
  intro('boss skills');

  const spec = parseSourceSpec(sourceArg, { cwd });
  log.info(`Source: ${spec.source}${spec.ref ? ` @ ${spec.ref}` : ''}`);

  const cloneSpin = spinner();
  cloneSpin.start(spec.kind === 'git' ? 'Cloning repository…' : 'Reading local source…');
  let resolved: ResolvedSource;
  try {
    resolved = resolveSource(spec);
  } catch (error) {
    cloneSpin.error(error instanceof Error ? error.message : String(error));
    outro('Failed.');
    return 1;
  }
  cloneSpin.stop(spec.kind === 'git' ? 'Repository cloned' : 'Local source ready');

  try {
    const { selected: available } = discoverSelectedSkills(resolved, flags.skillsFilter);
    log.success(`Found ${available.length} skill${available.length === 1 ? '' : 's'}`);

    let skills = available;
    if (available.length > 1) {
      const picked = await multiselect({
        message: 'Select skills to install (space to toggle)',
        options: available.map((skill) => ({
          value: skill.name,
          label: skill.name,
          hint: skill.description.length > 60 ? `${skill.description.slice(0, 57)}…` : skill.description
        })),
        required: true
      });
      if (isCancel(picked)) {
        cancel('Installation cancelled');
        return CANCELLED;
      }
      skills = available.filter((skill) => (picked as string[]).includes(skill.name));
    } else {
      log.info(`Skill: ${available[0]!.name}`);
    }

    const agentSpin = spinner();
    agentSpin.start('Loading agents…');
    agentSpin.stop(`${AGENT_REGISTRY.length} agents`);

    let agents: RegistryAgent[];
    if (flags.agentsFilter) {
      agents = resolveAgentsOrThrow(flags.agentsFilter);
    } else {
      const picked = await selectAgentsInteractive(flags.global ? 'global' : 'project');
      if (picked === PROMPT_CANCELLED) {
        cancel('Installation cancelled');
        return CANCELLED;
      }
      agents = picked;
    }

    const dirs = dirsForAgents(agents, flags.global ? 'global' : 'project', cwd);
    const outcomes: InstallOutcome[] = [];
    for (const skill of skills) {
      const installSpin = spinner();
      installSpin.start(`Installing ${skill.name}…`);
      let failedDirs = 0;
      for (const [abs, info] of dirs) {
        const outcome = installSkillToPath(skill, info.display, path.join(abs, skill.name));
        outcomes.push(outcome);
        if (outcome.status === 'failed') failedDirs += 1;
      }
      if (failedDirs === 0) {
        installSpin.stop(`✅ ${skill.name} → ${dirs.size} location${dirs.size === 1 ? '' : 's'}`);
      } else {
        installSpin.error(`❌ ${skill.name}: ${failedDirs}/${dirs.size} locations failed`);
      }
    }

    if (flags.global) {
      recordGlobalManifest(skills, outcomes, dirs, spec, resolved.commit);
    } else {
      recordProjectLock(cwd, skills, outcomes, dirs, spec, resolved.commit);
    }

    const failed = outcomes.filter((outcome) => outcome.status === 'failed');
    if (failed.length > 0) {
      for (const outcome of failed) {
        log.error(`${outcome.skill}: ${outcome.error} (${outcome.path})`);
      }
      outro(`Installed with ${failed.length} failure${failed.length === 1 ? '' : 's'}.`);
      return 1;
    }
    outro(`Installed ${skills.length} skill${skills.length === 1 ? '' : 's'} to ${dirs.size} location${dirs.size === 1 ? '' : 's'}.`);
    return 0;
  } finally {
    resolved.cleanup();
  }
}

function runAddHeadless(sourceArg: string, flags: SkillsFlags, context: CliContext, cwd: string): number {
  const spec = parseSourceSpec(sourceArg, { cwd });
  const resolved = resolveSource(spec);
  try {
    const { selected: skills } = discoverSelectedSkills(resolved, flags.skillsFilter);

    let agents: RegistryAgent[];
    if (flags.agentsFilter) {
      agents = resolveAgentsOrThrow(flags.agentsFilter);
    } else {
      const detected = detectInstalledAgents().filter((agent) => !flags.global || agent.globalSkillsDir);
      if (detected.length === 0) {
        throw new CliUserError({
          code: 'no_agents_detected',
          message: 'No agents detected to install to',
          retryable: false,
          suggestion: `Pass --agents with agent ids (e.g. ${AGENT_REGISTRY.slice(0, 3).map((a) => a.id).join(', ')})`
        });
      }
      // Detected installs always include the universal directory, like npx skills.
      agents = flags.global ? detected : [...getUniversalAgents(), ...detected];
    }

    const dirs = dirsForAgents(agents, flags.global ? 'global' : 'project', cwd);

    if (context.values.dryRun) {
      const actions = skills.flatMap((skill) =>
        [...dirs.entries()].map(([abs, info]) => ({
          skill: skill.name,
          dir: info.display,
          path: path.join(abs, skill.name),
          action: fs.existsSync(path.join(abs, skill.name)) ? 'overwrite' : 'install'
        }))
      );
      writeOutput({ actions, risk_tier: 'medium', requires_approval: false }, context, () =>
        actions.map((action) => `  [dry-run] ${action.skill}: ${action.action} at ${action.path}\n`).join('')
      );
      return 0;
    }

    const outcomes = installToDirs(skills, dirs);
    if (flags.global) {
      recordGlobalManifest(skills, outcomes, dirs, spec, resolved.commit);
    } else {
      recordProjectLock(cwd, skills, outcomes, dirs, spec, resolved.commit);
    }
    return reportOutcomes(outcomes, context);
  } finally {
    resolved.cleanup();
  }
}

async function runAdd(argv: string[], cwd: string): Promise<number> {
  const flags = parseSkillsFlags(argv);
  const context = createCliContext(flags.argv, { command: 'boss skills add' });
  const sourceArg = context.positionals[0];
  if (!sourceArg) {
    throw new CliUserError({
      code: 'missing_argument',
      message: 'Usage: boss skills add <source> [--skills a,b] [--agents id1,id2] [--global]',
      retryable: false,
      suggestion: 'Pass owner/repo, a git URL (optionally @ref) or a local directory'
    });
  }

  if (isInteractive(context)) {
    return runAddWizard(sourceArg, flags, cwd);
  }
  return runAddHeadless(sourceArg, flags, context, cwd);
}

function runList(argv: string[], cwd: string): number {
  const flags = parseSkillsFlags(argv);
  const context = createCliContext(flags.argv, { command: 'boss skills list' });

  if (flags.global) {
    const manifest = readManifest();
    writeOutput({ skills: manifest.skills }, context, () =>
      manifest.skills.length === 0
        ? 'No skills installed globally via boss skills add --global.\n'
        : `${manifest.skills
            .map((entry) => {
              const version = entry.version ? ` v${entry.version}` : '';
              const ref = entry.ref ? `@${entry.ref}` : '';
              return `  ${entry.name}${version} — ${entry.source}${ref} → ${entry.targets.map((t) => t.path).join(', ')}`;
            })
            .join('\n')}\n`
    );
    return 0;
  }

  const lock = readLocalLock(cwd);
  const entries = Object.entries(lock.skills);
  writeOutput({ skills: lock.skills }, context, () =>
    entries.length === 0
      ? 'No skills installed in this project. Run boss skills add <source>.\n'
      : `${entries
          .map(([name, entry]) => {
            const version = entry.version ? ` v${entry.version}` : '';
            const ref = entry.ref ? `@${entry.ref}` : '';
            return `  ${name}${version} — ${entry.source}${ref} → ${entry.dirs.join(', ')}`;
          })
          .join('\n')}\n`
  );
  return 0;
}

async function runUpdate(argv: string[], cwd: string): Promise<number> {
  const flags = parseSkillsFlags(argv);
  const context = createCliContext(flags.argv, { command: 'boss skills update' });
  const nameFilter = context.positionals[0];

  if (flags.global) {
    return runGlobalUpdate(nameFilter, context);
  }

  const lock = readLocalLock(cwd);
  const names = nameFilter ? [nameFilter] : Object.keys(lock.skills);
  const entries = names
    .map((name) => [name, lock.skills[name]] as const)
    .filter((pair): pair is [string, LocalLockEntry] => Boolean(pair[1]));
  if (entries.length === 0) {
    throw new CliUserError({
      code: 'unknown_skill',
      message: nameFilter ? `No installed skill named ${nameFilter}` : 'No skills installed in this project',
      retryable: false,
      suggestion: 'Run boss skills list to see installed skills'
    });
  }

  const outcomes: InstallOutcome[] = [];
  const bySource = new Map<string, [string, LocalLockEntry][]>();
  for (const pair of entries) {
    const key = `${pair[1].source} ${pair[1].ref ?? ''}`;
    bySource.set(key, [...(bySource.get(key) ?? []), pair]);
  }

  for (const group of bySource.values()) {
    const [, first] = group[0]!;
    const spec: SourceSpec = { source: first.source, kind: first.sourceType, ref: first.ref };
    let resolved: ResolvedSource;
    try {
      resolved = resolveSource(spec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const [name, entry] of group) {
        for (const dir of entry.dirs) {
          outcomes.push({ agent: dir, skill: name, path: path.join(cwd, dir, name), status: 'failed', error: message });
        }
      }
      continue;
    }
    try {
      const discovered = discoverSkills(resolved.dir);
      for (const [name, entry] of group) {
        const skill = discovered.find((candidate) => candidate.name === name);
        if (!skill) {
          for (const dir of entry.dirs) {
            outcomes.push({
              agent: dir,
              skill: name,
              path: path.join(cwd, dir, name),
              status: 'failed',
              error: 'skill no longer present in source'
            });
          }
          continue;
        }
        let updatedAny = false;
        for (const dir of entry.dirs) {
          const outcome = installSkillToPath(skill, dir, path.join(cwd, dir, name));
          outcomes.push(outcome);
          if (outcome.status === 'installed') updatedAny = true;
        }
        if (updatedAny) {
          entry.commit = resolved.commit;
          entry.version = skill.version;
          entry.installedAt = new Date().toISOString();
        }
      }
    } finally {
      resolved.cleanup();
    }
  }

  writeLocalLock(cwd, lock);
  return reportOutcomes(outcomes, context, 'updated');
}

function runGlobalUpdate(nameFilter: string | undefined, context: CliContext): number {
  const manifest = readManifest();
  const entries = nameFilter ? findEntriesByName(manifest, nameFilter) : manifest.skills;
  if (entries.length === 0) {
    throw new CliUserError({
      code: 'unknown_skill',
      message: nameFilter ? `No installed skill named ${nameFilter}` : 'No skills installed globally',
      retryable: false,
      suggestion: 'Run boss skills list --global to see installed skills'
    });
  }

  const outcomes: InstallOutcome[] = [];
  const bySource = new Map<string, ManifestEntry[]>();
  for (const entry of entries) {
    const key = `${entry.source} ${entry.ref ?? ''}`;
    bySource.set(key, [...(bySource.get(key) ?? []), entry]);
  }

  for (const group of bySource.values()) {
    const first = group[0]!;
    const spec: SourceSpec = { source: first.source, kind: first.kind, ref: first.ref };
    let resolved: ResolvedSource;
    try {
      resolved = resolveSource(spec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of group) {
        for (const target of entry.targets) {
          outcomes.push({ agent: target.agent, skill: entry.name, path: target.path, status: 'failed', error: message });
        }
      }
      continue;
    }
    try {
      const discovered = discoverSkills(resolved.dir);
      for (const entry of group) {
        const skill = discovered.find((candidate) => candidate.name === entry.name);
        if (!skill) {
          for (const target of entry.targets) {
            outcomes.push({
              agent: target.agent,
              skill: entry.name,
              path: target.path,
              status: 'failed',
              error: 'skill no longer present in source'
            });
          }
          continue;
        }
        let updatedAny = false;
        for (const target of entry.targets) {
          const outcome = installSkillToPath(skill, target.agent, target.path);
          outcomes.push(outcome);
          if (outcome.status === 'installed') updatedAny = true;
        }
        if (updatedAny) {
          entry.commit = resolved.commit;
          entry.version = skill.version;
          entry.description = skill.description || undefined;
          entry.installedAt = new Date().toISOString();
        }
      }
    } finally {
      resolved.cleanup();
    }
  }

  writeManifest(manifest);
  return reportOutcomes(outcomes, context, 'updated');
}

async function runRemove(argv: string[], cwd: string): Promise<number> {
  const flags = parseSkillsFlags(argv);
  const context = createCliContext(flags.argv, { command: 'boss skills remove' });
  const name = context.positionals[0];
  if (!name) {
    throw new CliUserError({
      code: 'missing_argument',
      message: 'Usage: boss skills remove <name> [--global]',
      retryable: false,
      suggestion: 'Run boss skills list to see installed skills'
    });
  }

  if (flags.global) {
    return runGlobalRemove(name, context);
  }

  const lock = readLocalLock(cwd);
  const entry = lock.skills[name];
  if (!entry) {
    throw new CliUserError({
      code: 'unknown_skill',
      message: `No installed skill named ${name} in this project`,
      input: { name },
      retryable: false,
      suggestion: 'Run boss skills list to see installed skills'
    });
  }

  if (isInteractive(context)) {
    intro('boss skills remove');
    const answer = await confirm({ message: `Remove ${name} from ${entry.dirs.join(', ')}?` });
    if (isCancel(answer) || !answer) {
      cancel('Remove cancelled.');
      return CANCELLED;
    }
  } else {
    assertConfirmed(context, 'skills remove');
  }

  const outcomes: InstallOutcome[] = [];
  for (const dir of entry.dirs) {
    const dest = path.join(cwd, dir, name);
    try {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
      outcomes.push({ agent: dir, skill: name, path: dest, status: 'installed' });
    } catch (error) {
      outcomes.push({
        agent: dir,
        skill: name,
        path: dest,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (outcomes.every((outcome) => outcome.status === 'installed')) {
    delete lock.skills[name];
  }
  writeLocalLock(cwd, lock);

  const exitCode = reportOutcomes(outcomes, context, 'removed');
  if (isInteractive(context)) outro(exitCode === 0 ? 'Removed.' : 'Remove finished with failures.');
  return exitCode;
}

function runGlobalRemove(name: string, context: CliContext): number {
  const manifest = readManifest();
  const entries = findEntriesByName(manifest, name);
  if (entries.length === 0) {
    throw new CliUserError({
      code: 'unknown_skill',
      message: `No installed skill named ${name}`,
      input: { name },
      retryable: false,
      suggestion: 'Run boss skills list --global to see installed skills'
    });
  }
  assertConfirmed(context, 'skills remove');

  const outcomes: InstallOutcome[] = [];
  for (const entry of entries) {
    for (const target of [...entry.targets]) {
      try {
        if (fs.existsSync(target.path)) fs.rmSync(target.path, { recursive: true });
        removeTarget(manifest, entry, target.path);
        outcomes.push({ agent: target.agent, skill: entry.name, path: target.path, status: 'installed' });
      } catch (error) {
        outcomes.push({
          agent: target.agent,
          skill: entry.name,
          path: target.path,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  writeManifest(manifest);
  return reportOutcomes(outcomes, context, 'removed');
}

export async function main(argv: string[] = process.argv.slice(2), { cwd = process.cwd() }: { cwd?: string } = {}): Promise<number> {
  const sub = argv.find((arg) => !arg.startsWith('-'));

  switch (sub) {
    case 'add':
      return runAdd(argv.slice(argv.indexOf('add') + 1), cwd);
    case 'list':
      return runList(argv.slice(argv.indexOf('list') + 1), cwd);
    case 'update':
      return runUpdate(argv.slice(argv.indexOf('update') + 1), cwd);
    case 'remove':
      return runRemove(argv.slice(argv.indexOf('remove') + 1), cwd);
    case undefined:
      process.stdout.write(SKILLS_USAGE);
      return 0;
    default:
      throw new CliUserError({
        code: 'unknown_command',
        message: `Unknown command: skills ${sub}`,
        input: { command: sub },
        retryable: false,
        suggestion: 'Run boss skills --help to list available commands'
      });
  }
}
