#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCliContext,
  describeCommand,
  runMain,
  writeOutput
} from '../cli/contract.js';
import { commandDescriptions } from '../cli/registry.js';
import { AGENTS, PKG_ROOT } from './install/index.js';
import { readJsonlTolerant } from '../infrastructure/fs.js';

type CheckStatus = 'ok' | 'warn' | 'error';

interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')
) as { version: string };

/** boss 装到哪些 agent、版本是否与当前包一致。 */
function checkInstalls(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  for (const agent of AGENTS) {
    if (agent.method === 'plugin') {
      checks.push({
        name: `install:${agent.name}`,
        status: 'ok',
        detail: `plugin 模式，根目录 ${agent.dest()}`
      });
      continue;
    }
    const dest = agent.dest();
    const detected = agent.detect();
    if (!fs.existsSync(dest)) {
      checks.push({
        name: `install:${agent.name}`,
        status: detected ? 'warn' : 'ok',
        detail: detected
          ? `已检测到 ${agent.name} 但未安装 boss（运行 boss install 安装）`
          : `未检测到 ${agent.name}，跳过`
      });
      continue;
    }
    const skillMd = path.join(dest, 'SKILL.md');
    const installedVersion = readSkillVersion(skillMd);
    const versionMatch = installedVersion === pkg.version;
    checks.push({
      name: `install:${agent.name}`,
      status: versionMatch ? 'ok' : 'warn',
      detail: versionMatch
        ? `已安装 v${installedVersion}（与当前包一致）`
        : `已安装 v${installedVersion ?? '未知'}，当前包为 v${pkg.version}（建议重装）`
    });
  }
  return checks;
}

function readSkillVersion(skillMd: string): string | undefined {
  if (!fs.existsSync(skillMd)) return undefined;
  const content = fs.readFileSync(skillMd, 'utf8');
  const match = content.match(/^version:\s*(.+)$/m);
  return match ? match[1]!.trim() : undefined;
}

/** 项目内每个 feature 的事件流完整性与孤儿 lock。 */
function checkFeatures(cwd: string): DoctorCheck[] {
  const bossRoot = path.join(cwd, '.boss');
  if (!fs.existsSync(bossRoot)) {
    return [{ name: 'features', status: 'ok', detail: '当前目录无 .boss/（非 boss 项目）' }];
  }

  const checks: DoctorCheck[] = [];
  const features = fs
    .readdirSync(bossRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);

  if (features.length === 0) {
    return [{ name: 'features', status: 'ok', detail: '.boss/ 下暂无 feature' }];
  }

  for (const feature of features) {
    const metaDir = path.join(bossRoot, feature, '.meta');
    const eventsFile = path.join(metaDir, 'events.jsonl');

    if (!fs.existsSync(eventsFile)) {
      checks.push({
        name: `feature:${feature}`,
        status: 'warn',
        detail: '缺少 events.jsonl（事件流真相源不存在）'
      });
      continue;
    }

    try {
      const { records, corruptTail } = readJsonlTolerant(eventsFile);
      if (corruptTail !== undefined) {
        checks.push({
          name: `feature:${feature}`,
          status: 'warn',
          detail: `事件流末尾有损坏行（疑似写入中途崩溃，将被跳过）：${corruptTail.slice(0, 60)}`
        });
      } else {
        checks.push({
          name: `feature:${feature}`,
          status: 'ok',
          detail: `事件流完整，${records.length} 条事件`
        });
      }
    } catch (err) {
      checks.push({
        name: `feature:${feature}`,
        status: 'error',
        detail: `事件流中间行损坏（篡改或磁盘错误，无法投影）：${(err as Error).message}`
      });
    }

    // 孤儿 lock：knowledge worker lock 早已废弃；任何残留 *.lock 都提示可清理
    if (fs.existsSync(metaDir)) {
      const locks = fs.readdirSync(metaDir).filter((name) => name.endsWith('.lock'));
      for (const lock of locks) {
        checks.push({
          name: `feature:${feature}:lock`,
          status: 'warn',
          detail: `残留 lock 文件 ${lock}（若无正在运行的进程可安全删除）`
        });
      }
    }
  }

  return checks;
}

function showHelp(): void {
  process.stdout.write('boss doctor [--json]\n  诊断安装位置、版本一致性、事件流完整性、孤儿 lock。\n');
}

export function main(
  argv: string[] = process.argv.slice(2),
  { cwd = process.cwd() }: { cwd?: string } = {}
): number {
  const context = createCliContext(argv, { command: 'boss doctor' });
  if (context.values.describe) {
    writeOutput(
      describeCommand(commandDescriptions['boss doctor']!),
      context,
      () => `${JSON.stringify(commandDescriptions['boss doctor'], null, 2)}\n`
    );
    return 0;
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    showHelp();
    return 0;
  }

  const checks: DoctorCheck[] = [
    { name: 'version', status: 'ok', detail: `boss-skill v${pkg.version}` },
    ...checkInstalls(),
    ...checkFeatures(cwd)
  ];

  const errorCount = checks.filter((c) => c.status === 'error').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const overall: CheckStatus = errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok';

  writeOutput(
    { status: overall, errorCount, warnCount, checks },
    context,
    () => {
      const icon = (s: CheckStatus) => (s === 'ok' ? '✅' : s === 'warn' ? '⚠️ ' : '❌');
      const lines = [
        `boss doctor — ${icon(overall)} ${overall.toUpperCase()}（${errorCount} 错误 / ${warnCount} 警告）`,
        '',
        ...checks.map((c) => `  ${icon(c.status)} ${c.name}: ${c.detail}`)
      ];
      return `${lines.join('\n')}\n`;
    }
  );

  // error 才非零退出；warn 不阻断（诊断信息，不是门禁）
  return errorCount > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const context = createCliContext(process.argv.slice(2), {
    command: 'boss doctor',
    validateOptionValues: false
  });
  process.exit(await runMain(() => main(process.argv.slice(2), { cwd: process.cwd() }), context));
}
