import { runtimeCommandNames } from './registry.js';
import { renderHelp } from './contract.js';
import {
  artifactDescription,
  designDescription,
  gateDescription,
  hooksDescription,
  packsDescription,
  projectDescription,
  qaDescription,
  rootDescription,
  runtimeDescription,
  skillsDescription
} from './registry.js';

export const ROOT_USAGE = [
  renderHelp(rootDescription, 'boss COMMAND [options]'),
  'Commands:',
  '  install',
  '  uninstall',
  '  path',
  '  skills add SOURCE',
  '  skills list',
  '  skills update [NAME]',
  '  skills remove NAME',
  '  status FEATURE',
  '  continue FEATURE',
  '  gate FEATURE',
  '  qa attack FEATURE',
  '  runtime COMMAND',
  '  design preview',
  '  project init',
  '  artifact prepare',
  '  packs detect',
  '  hooks run',
  '',
  'Compatibility:',
  '  boss-skill install',
  ''
].join('\n');

export const RUNTIME_USAGE = [
  renderHelp(runtimeDescription, 'boss runtime COMMAND [args...]'),
  'Commands:',
  ...runtimeCommandNames.map((name) => `  ${name}`),
  ''
].join('\n');

export const GATE_USAGE = [
  renderHelp(gateDescription, 'boss gate <feature> [--gate <gateName>]'),
  'Commands:',
  '  final',
  ''
].join('\n');

export const QA_USAGE = [
  renderHelp(qaDescription, 'boss qa attack <feature>'),
  'Commands:',
  '  attack',
  ''
].join('\n');

export const DESIGN_USAGE = [
  renderHelp(designDescription, 'boss design preview <feature> [--no-open] [--port <port>]'),
  'Commands:',
  '  preview',
  ''
].join('\n');

export const PROJECT_USAGE = [
  renderHelp(projectDescription, 'boss project init <feature-name> [--template] [--force]'),
  'Commands:',
  '  init',
  ''
].join('\n');

export const ARTIFACT_USAGE = [
  renderHelp(artifactDescription, 'boss artifact prepare <feature-name> <artifact-name> [template-name]'),
  'Commands:',
  '  prepare',
  ''
].join('\n');

export const PACKS_USAGE = [
  renderHelp(packsDescription, 'boss packs detect [project-dir]'),
  'Commands:',
  '  detect',
  ''
].join('\n');

export const SKILLS_USAGE = [
  renderHelp(skillsDescription, 'boss skills COMMAND [options]'),
  'Commands:',
  '  add <source> [--skills a,b] [--agents id1,id2] [--global]',
  '      Install skills from owner/repo, git URL (@ref) or local dir.',
  '      Default: project install (.agents/skills + per-agent dirs, skills-lock.json).',
  '      --global installs to each agent home directory instead.',
  '  list [--global]              Show installed skills',
  '  update [name] [--global]     Re-fetch sources and reinstall',
  '  remove <name> [--global]     Remove installed copies',
  ''
].join('\n');

export const HOOKS_USAGE = [
  renderHelp(hooksDescription, 'boss hooks run <hook-id> <script-relative-path> [profiles-csv]'),
  'Commands:',
  '  run',
  ''
].join('\n');

export function showRootHelp(): void {
  process.stdout.write(ROOT_USAGE);
}

export function showRuntimeHelp(): void {
  process.stdout.write(RUNTIME_USAGE);
}
