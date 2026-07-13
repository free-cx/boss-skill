import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Ported from the `skills` CLI (npx skills) agent registry so `boss skills add`
// reproduces its wizard: agents whose project skillsDir is the shared
// `.agents/skills` folder form the "Universal — always included" group.

const home = os.homedir();
const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || path.join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, '.claude');
const vibeHome = process.env.VIBE_HOME?.trim() || path.join(home, '.vibe');
const hermesHome = process.env.HERMES_HOME?.trim() || path.join(home, '.hermes');
const autohandHome = process.env.AUTOHAND_HOME?.trim() || path.join(home, '.autohand');
const zedAppDataHome = process.env.APPDATA?.trim();
const zedFlatpakConfigHome = process.env.FLATPAK_XDG_CONFIG_HOME?.trim();

export const UNIVERSAL_SKILLS_DIR = '.agents/skills';

export interface RegistryAgent {
  id: string;
  displayName: string;
  /** project-relative directory that receives skills as <skillsDir>/<skill-name>/ */
  skillsDir: string;
  /** absolute home-level directory for --global installs */
  globalSkillsDir?: string;
  showInUniversalList?: boolean;
  showInUniversalPrompt?: boolean;
  detect: () => boolean;
}

function inHome(...segments: string[]): () => boolean {
  return () => fs.existsSync(path.join(home, ...segments));
}

function packageJsonHasDependency(packageJsonPath: string, dependencyName: string): boolean {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(packageJson.dependencies?.[dependencyName] || packageJson.devDependencies?.[dependencyName]);
  } catch {
    return false;
  }
}

function getOpenClawGlobalSkillsDir(): string {
  if (fs.existsSync(path.join(home, '.openclaw'))) return path.join(home, '.openclaw/skills');
  if (fs.existsSync(path.join(home, '.clawdbot'))) return path.join(home, '.clawdbot/skills');
  if (fs.existsSync(path.join(home, '.moltbot'))) return path.join(home, '.moltbot/skills');
  return path.join(home, '.openclaw/skills');
}

export const AGENT_REGISTRY: RegistryAgent[] = [
  { id: 'aider-desk', displayName: 'AiderDesk', skillsDir: '.aider-desk/skills', globalSkillsDir: path.join(home, '.aider-desk/skills'), detect: inHome('.aider-desk') },
  { id: 'amp', displayName: 'Amp', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(configHome, 'agents/skills'), detect: () => fs.existsSync(path.join(configHome, 'amp')) },
  { id: 'antigravity', displayName: 'Antigravity', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.gemini/antigravity/skills'), detect: inHome('.gemini/antigravity') },
  { id: 'antigravity-cli', displayName: 'Antigravity CLI', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.gemini/antigravity-cli/skills'), detect: inHome('.gemini/antigravity-cli') },
  { id: 'astrbot', displayName: 'AstrBot', skillsDir: 'data/skills', globalSkillsDir: path.join(home, '.astrbot/data/skills'), detect: () => fs.existsSync(path.join(process.cwd(), 'data/skills')) || fs.existsSync(path.join(home, '.astrbot')) },
  { id: 'autohand-code', displayName: 'Autohand Code CLI', skillsDir: '.autohand/skills', globalSkillsDir: path.join(autohandHome, 'skills'), detect: () => fs.existsSync(autohandHome) },
  { id: 'augment', displayName: 'Augment', skillsDir: '.augment/skills', globalSkillsDir: path.join(home, '.augment/skills'), detect: inHome('.augment') },
  { id: 'bob', displayName: 'IBM Bob', skillsDir: '.bob/skills', globalSkillsDir: path.join(home, '.bob/skills'), detect: inHome('.bob') },
  { id: 'claude-code', displayName: 'Claude Code', skillsDir: '.claude/skills', globalSkillsDir: path.join(claudeHome, 'skills'), detect: () => fs.existsSync(claudeHome) },
  { id: 'openclaw', displayName: 'OpenClaw', skillsDir: 'skills', globalSkillsDir: getOpenClawGlobalSkillsDir(), detect: () => fs.existsSync(path.join(home, '.openclaw')) || fs.existsSync(path.join(home, '.clawdbot')) || fs.existsSync(path.join(home, '.moltbot')) },
  { id: 'cline', displayName: 'Cline', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.agents', 'skills'), detect: inHome('.cline') },
  { id: 'codearts-agent', displayName: 'CodeArts Agent', skillsDir: '.codeartsdoer/skills', globalSkillsDir: path.join(home, '.codeartsdoer/skills'), detect: inHome('.codeartsdoer') },
  { id: 'codebuddy', displayName: 'CodeBuddy', skillsDir: '.codebuddy/skills', globalSkillsDir: path.join(home, '.codebuddy/skills'), detect: () => fs.existsSync(path.join(process.cwd(), '.codebuddy')) || fs.existsSync(path.join(home, '.codebuddy')) },
  { id: 'codemaker', displayName: 'Codemaker', skillsDir: '.codemaker/skills', globalSkillsDir: path.join(home, '.codemaker/skills'), detect: inHome('.codemaker') },
  { id: 'codestudio', displayName: 'Code Studio', skillsDir: '.codestudio/skills', globalSkillsDir: path.join(home, '.codestudio/skills'), detect: inHome('.codestudio') },
  { id: 'codex', displayName: 'Codex', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(codexHome, 'skills'), detect: () => fs.existsSync(codexHome) || fs.existsSync('/etc/codex') },
  { id: 'command-code', displayName: 'Command Code', skillsDir: '.commandcode/skills', globalSkillsDir: path.join(home, '.commandcode/skills'), detect: inHome('.commandcode') },
  { id: 'continue', displayName: 'Continue', skillsDir: '.continue/skills', globalSkillsDir: path.join(home, '.continue/skills'), detect: () => fs.existsSync(path.join(process.cwd(), '.continue')) || fs.existsSync(path.join(home, '.continue')) },
  { id: 'cortex', displayName: 'Cortex Code', skillsDir: '.cortex/skills', globalSkillsDir: path.join(home, '.snowflake/cortex/skills'), detect: inHome('.snowflake/cortex') },
  { id: 'crush', displayName: 'Crush', skillsDir: '.crush/skills', globalSkillsDir: path.join(home, '.config/crush/skills'), detect: inHome('.config/crush') },
  { id: 'cursor', displayName: 'Cursor', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.cursor/skills'), detect: inHome('.cursor') },
  { id: 'deepagents', displayName: 'Deep Agents', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.deepagents/agent/skills'), detect: inHome('.deepagents') },
  { id: 'devin', displayName: 'Devin for Terminal', skillsDir: '.devin/skills', globalSkillsDir: path.join(configHome, 'devin/skills'), detect: () => fs.existsSync(path.join(configHome, 'devin')) },
  { id: 'dexto', displayName: 'Dexto', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.agents/skills'), showInUniversalPrompt: false, detect: inHome('.dexto') },
  { id: 'droid', displayName: 'Droid', skillsDir: '.factory/skills', globalSkillsDir: path.join(home, '.factory/skills'), detect: inHome('.factory') },
  { id: 'eve', displayName: 'Eve', skillsDir: 'agent/skills', detect: () => fs.existsSync(path.join(process.cwd(), 'agent')) && packageJsonHasDependency(path.join(process.cwd(), 'package.json'), 'eve') },
  { id: 'firebender', displayName: 'Firebender', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.firebender/skills'), showInUniversalPrompt: false, detect: inHome('.firebender') },
  { id: 'forgecode', displayName: 'ForgeCode', skillsDir: '.forge/skills', globalSkillsDir: path.join(home, '.forge/skills'), detect: inHome('.forge') },
  { id: 'gemini-cli', displayName: 'Gemini CLI', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.gemini/skills'), detect: inHome('.gemini') },
  { id: 'github-copilot', displayName: 'GitHub Copilot', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.copilot/skills'), detect: inHome('.copilot') },
  { id: 'goose', displayName: 'Goose', skillsDir: '.goose/skills', globalSkillsDir: path.join(configHome, 'goose/skills'), detect: () => fs.existsSync(path.join(configHome, 'goose')) },
  { id: 'hermes-agent', displayName: 'Hermes Agent', skillsDir: '.hermes/skills', globalSkillsDir: path.join(hermesHome, 'skills'), detect: () => fs.existsSync(hermesHome) },
  { id: 'inference-sh', displayName: 'inference.sh', skillsDir: '.inferencesh/skills', globalSkillsDir: path.join(home, '.inferencesh/skills'), detect: inHome('.inferencesh') },
  { id: 'jazz', displayName: 'Jazz', skillsDir: '.jazz/skills', globalSkillsDir: path.join(home, '.jazz/skills'), detect: () => fs.existsSync(path.join(home, '.jazz')) || fs.existsSync(path.join(process.cwd(), '.jazz')) },
  { id: 'junie', displayName: 'Junie', skillsDir: '.junie/skills', globalSkillsDir: path.join(home, '.junie/skills'), detect: inHome('.junie') },
  { id: 'iflow-cli', displayName: 'iFlow CLI', skillsDir: '.iflow/skills', globalSkillsDir: path.join(home, '.iflow/skills'), detect: inHome('.iflow') },
  { id: 'kilo', displayName: 'Kilo Code', skillsDir: '.kilocode/skills', globalSkillsDir: path.join(home, '.kilocode/skills'), detect: inHome('.kilocode') },
  { id: 'kimi-code-cli', displayName: 'Kimi Code CLI', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.agents/skills'), detect: () => fs.existsSync(path.join(home, '.kimi-code')) || fs.existsSync(path.join(home, '.kimi')) },
  { id: 'kiro-cli', displayName: 'Kiro CLI', skillsDir: '.kiro/skills', globalSkillsDir: path.join(home, '.kiro/skills'), detect: inHome('.kiro') },
  { id: 'kode', displayName: 'Kode', skillsDir: '.kode/skills', globalSkillsDir: path.join(home, '.kode/skills'), detect: inHome('.kode') },
  { id: 'lingma', displayName: 'Lingma', skillsDir: '.lingma/skills', globalSkillsDir: path.join(home, '.lingma/skills'), detect: inHome('.lingma') },
  { id: 'loaf', displayName: 'Loaf', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.agents/skills'), showInUniversalPrompt: false, detect: inHome('.loaf') },
  { id: 'mcpjam', displayName: 'MCPJam', skillsDir: '.mcpjam/skills', globalSkillsDir: path.join(home, '.mcpjam/skills'), detect: inHome('.mcpjam') },
  { id: 'mistral-vibe', displayName: 'Mistral Vibe', skillsDir: '.vibe/skills', globalSkillsDir: path.join(vibeHome, 'skills'), detect: () => fs.existsSync(vibeHome) },
  { id: 'moxby', displayName: 'Moxby', skillsDir: '.moxby/skills', globalSkillsDir: path.join(home, '.moxby/skills'), detect: inHome('.moxby') },
  { id: 'mux', displayName: 'Mux', skillsDir: '.mux/skills', globalSkillsDir: path.join(home, '.mux/skills'), detect: inHome('.mux') },
  { id: 'opencode', displayName: 'OpenCode', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(configHome, 'opencode/skills'), detect: () => fs.existsSync(path.join(configHome, 'opencode')) },
  { id: 'openhands', displayName: 'OpenHands', skillsDir: '.openhands/skills', globalSkillsDir: path.join(home, '.openhands/skills'), detect: inHome('.openhands') },
  { id: 'ona', displayName: 'Ona', skillsDir: '.ona/skills', globalSkillsDir: path.join(home, '.ona/skills'), detect: inHome('.ona') },
  { id: 'pi', displayName: 'Pi', skillsDir: '.pi/skills', globalSkillsDir: path.join(home, '.pi/agent/skills'), detect: inHome('.pi/agent') },
  { id: 'qoder', displayName: 'Qoder', skillsDir: '.qoder/skills', globalSkillsDir: path.join(home, '.qoder/skills'), detect: inHome('.qoder') },
  { id: 'qoder-cn', displayName: 'Qoder CN', skillsDir: '.qoder/skills', globalSkillsDir: path.join(home, '.qoder-cn/skills'), detect: inHome('.qoder-cn') },
  { id: 'qwen-code', displayName: 'Qwen Code', skillsDir: '.qwen/skills', globalSkillsDir: path.join(home, '.qwen/skills'), detect: inHome('.qwen') },
  { id: 'replit', displayName: 'Replit', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(configHome, 'agents/skills'), showInUniversalList: false, detect: () => fs.existsSync(path.join(process.cwd(), '.replit')) },
  { id: 'reasonix', displayName: 'Reasonix', skillsDir: '.reasonix/skills', globalSkillsDir: path.join(home, '.reasonix/skills'), detect: inHome('.reasonix') },
  { id: 'rovodev', displayName: 'Rovo Dev', skillsDir: '.rovodev/skills', globalSkillsDir: path.join(home, '.rovodev/skills'), detect: inHome('.rovodev') },
  { id: 'roo', displayName: 'Roo Code', skillsDir: '.roo/skills', globalSkillsDir: path.join(home, '.roo/skills'), detect: inHome('.roo') },
  { id: 'tabnine-cli', displayName: 'Tabnine CLI', skillsDir: '.tabnine/agent/skills', globalSkillsDir: path.join(home, '.tabnine/agent/skills'), detect: inHome('.tabnine') },
  { id: 'terramind', displayName: 'Terramind', skillsDir: '.terramind/skills', globalSkillsDir: path.join(home, '.terramind/skills'), detect: inHome('.terramind') },
  { id: 'tinycloud', displayName: 'Tinycloud', skillsDir: '.tinycloud/skills', globalSkillsDir: path.join(home, '.tinycloud/skills'), detect: inHome('.tinycloud') },
  { id: 'trae', displayName: 'Trae', skillsDir: '.trae/skills', globalSkillsDir: path.join(home, '.trae/skills'), detect: inHome('.trae') },
  { id: 'trae-cn', displayName: 'Trae CN', skillsDir: '.trae/skills', globalSkillsDir: path.join(home, '.trae-cn/skills'), detect: inHome('.trae-cn') },
  { id: 'warp', displayName: 'Warp', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.agents/skills'), detect: inHome('.warp') },
  { id: 'windsurf', displayName: 'Windsurf', skillsDir: '.windsurf/skills', globalSkillsDir: path.join(home, '.codeium/windsurf/skills'), detect: inHome('.codeium/windsurf') },
  { id: 'zed', displayName: 'Zed', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(home, '.agents/skills'), detect: () => fs.existsSync(path.join(configHome, 'zed')) || Boolean(zedAppDataHome && fs.existsSync(path.join(zedAppDataHome, 'Zed'))) || Boolean(zedFlatpakConfigHome && fs.existsSync(path.join(zedFlatpakConfigHome, 'zed'))) },
  { id: 'zcode', displayName: 'ZCode', skillsDir: '.zcode/skills', globalSkillsDir: path.join(home, '.zcode/skills'), detect: () => fs.existsSync(path.join(home, '.zcode')) || fs.existsSync('/Applications/ZCode.app') },
  { id: 'zencoder', displayName: 'Zencoder', skillsDir: '.zencoder/skills', globalSkillsDir: path.join(home, '.zencoder/skills'), detect: inHome('.zencoder') },
  { id: 'zenflow', displayName: 'Zenflow', skillsDir: '.zencoder/skills', globalSkillsDir: path.join(home, '.zencoder/skills'), detect: inHome('.zencoder') },
  { id: 'neovate', displayName: 'Neovate', skillsDir: '.neovate/skills', globalSkillsDir: path.join(home, '.neovate/skills'), detect: inHome('.neovate') },
  { id: 'pochi', displayName: 'Pochi', skillsDir: '.pochi/skills', globalSkillsDir: path.join(home, '.pochi/skills'), detect: inHome('.pochi') },
  { id: 'promptscript', displayName: 'PromptScript', skillsDir: UNIVERSAL_SKILLS_DIR, showInUniversalPrompt: false, detect: () => fs.existsSync(path.join(process.cwd(), '.promptscript')) || fs.existsSync(path.join(process.cwd(), 'promptscript.yaml')) },
  { id: 'adal', displayName: 'AdaL', skillsDir: '.adal/skills', globalSkillsDir: path.join(home, '.adal/skills'), detect: inHome('.adal') },
  { id: 'universal', displayName: 'Universal', skillsDir: UNIVERSAL_SKILLS_DIR, globalSkillsDir: path.join(configHome, 'agents/skills'), showInUniversalList: false, detect: () => false }
];

export function findRegistryAgent(id: string): RegistryAgent | undefined {
  return AGENT_REGISTRY.find((agent) => agent.id === id);
}

export function isUniversalAgent(agent: RegistryAgent): boolean {
  return agent.skillsDir === UNIVERSAL_SKILLS_DIR;
}

/** Universal agents shown in the locked "always included" section. */
export function getUniversalAgents(): RegistryAgent[] {
  return AGENT_REGISTRY.filter((agent) => isUniversalAgent(agent) && agent.showInUniversalList !== false);
}

export function getVisibleUniversalAgents(): RegistryAgent[] {
  return getUniversalAgents().filter((agent) => agent.showInUniversalPrompt !== false);
}

export function getNonUniversalAgents(): RegistryAgent[] {
  return AGENT_REGISTRY.filter((agent) => !isUniversalAgent(agent));
}

export function detectInstalledAgents(): RegistryAgent[] {
  return AGENT_REGISTRY.filter((agent) => agent.id !== 'universal' && agent.detect());
}
