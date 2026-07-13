import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CliUserError } from '../cli/contract.js';

export interface SourceSpec {
  /** canonical source location (git URL or absolute local path) recorded in the manifest */
  source: string;
  kind: 'git' | 'local';
  ref?: string;
}

export interface ResolvedSource extends SourceSpec {
  /** local directory containing the source tree */
  dir: string;
  /** resolved commit sha for git sources */
  commit?: string;
  /** removes the temporary checkout (no-op for local sources) */
  cleanup: () => void;
}

const OWNER_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isGitUrl(location: string): boolean {
  return (
    location.startsWith('http://') ||
    location.startsWith('https://') ||
    location.startsWith('git@') ||
    location.startsWith('ssh://') ||
    location.startsWith('git://') ||
    location.startsWith('file://')
  );
}

/**
 * Parse a user-supplied source into a canonical spec.
 * Supported: existing local paths, owner/repo shorthand, GitHub/any git URLs,
 * each optionally pinned with a trailing @ref (branch, tag or commit).
 */
export function parseSourceSpec(input: string, { cwd = process.cwd() }: { cwd?: string } = {}): SourceSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new CliUserError({
      code: 'invalid_source',
      message: 'Source is empty',
      retryable: false,
      suggestion: 'Pass a git URL, owner/repo shorthand or a local directory path'
    });
  }

  // A path that exists on disk wins outright — no @ref parsing for local dirs.
  const asPath = path.resolve(cwd, trimmed);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory()) {
    return { source: asPath, kind: 'local' };
  }

  // @ref only counts when the '@' appears after the last '/', so git@host URLs stay intact.
  let location = trimmed;
  let ref: string | undefined;
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex > trimmed.lastIndexOf('/') && atIndex > 0) {
    location = trimmed.slice(0, atIndex);
    ref = trimmed.slice(atIndex + 1) || undefined;
  }

  if (isGitUrl(location)) {
    return { source: location, kind: 'git', ref };
  }

  if (OWNER_REPO_PATTERN.test(location)) {
    return { source: `https://github.com/${location}.git`, kind: 'git', ref };
  }

  throw new CliUserError({
    code: 'invalid_source',
    message: `Unrecognized source: ${input}`,
    input: { source: input },
    retryable: false,
    suggestion: 'Use owner/repo, a git URL (optionally @branch/@tag/@commit) or an existing local directory'
  });
}

function runGit(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) {
    throw new CliUserError({
      code: 'git_not_found',
      message: 'git is required to install skills from a repository but was not found on PATH',
      retryable: false,
      suggestion: 'Install git (https://git-scm.com) and retry'
    });
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function assertGitAvailable(): void {
  runGit(['--version']);
}

function cloneFailure(spec: SourceSpec, stderr: string): CliUserError {
  return new CliUserError({
    code: 'clone_failed',
    message: `Failed to fetch ${spec.source}${spec.ref ? `@${spec.ref}` : ''}: ${stderr.trim().split('\n').pop() ?? 'unknown git error'}`,
    input: { source: spec.source, ref: spec.ref },
    retryable: true,
    suggestion: 'Check the URL/ref and your git credentials for private repositories'
  });
}

function shallowFetchRef(spec: SourceSpec, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const steps: string[][] = [
    ['init', '--quiet'],
    ['remote', 'add', 'origin', spec.source],
    ['fetch', '--quiet', '--depth', '1', 'origin', spec.ref!],
    ['checkout', '--quiet', '--detach', 'FETCH_HEAD']
  ];
  for (const args of steps) {
    const result = runGit(args, dest);
    if (result.status !== 0) {
      throw cloneFailure(spec, result.stderr);
    }
  }
}

/**
 * Materialize a source on disk. Git sources are shallow-cloned into a fresh
 * temporary directory; local sources are used in place.
 */
export function resolveSource(spec: SourceSpec): ResolvedSource {
  if (spec.kind === 'local') {
    return { ...spec, dir: spec.source, cleanup: () => {} };
  }

  assertGitAvailable();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-skill-src-'));
  const cleanup = () => fs.rmSync(dest, { recursive: true, force: true });

  try {
    if (spec.ref) {
      // --branch only accepts branches/tags; fetch-by-ref also covers commit shas.
      const cloned = runGit(['clone', '--quiet', '--depth', '1', '--branch', spec.ref, spec.source, dest]);
      if (cloned.status !== 0) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        shallowFetchRef(spec, dest);
      }
    } else {
      const cloned = runGit(['clone', '--quiet', '--depth', '1', spec.source, dest]);
      if (cloned.status !== 0) {
        throw cloneFailure(spec, cloned.stderr);
      }
    }

    const head = runGit(['rev-parse', 'HEAD'], dest);
    const commit = head.status === 0 ? head.stdout.trim() : undefined;
    return { ...spec, dir: dest, commit, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
