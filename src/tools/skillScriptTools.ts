/**
 * skillScriptTools.ts — run_skill_script
 *
 * Runs a bundled RPG Maker agent-skill helper script (from the
 * rpgmaker-agent-skills pack installed under .claude/rpgmaker-scripts/)
 * against the active project and returns its report as text.
 *
 * Security: scripts are allow-listed (no arbitrary command execution), the
 * project path and per-script args are passed as separate argv entries (never
 * interpolated into a shell string), and no shell is spawned. This mirrors the
 * safe_write / dry-run discipline of the skill pack: checkers never modify the
 * project, and scaffold_event is a pure stdout generator.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/** Top-level helper scripts shipped by the skill pack (present in rpgmaker-scripts/scripts). */
export const SKILL_SCRIPT_NAMES = [
  'validate_project',
  'check_orphaned_refs',
  'check_switch_collisions',
  'find_event_refs',
  'list_switches',
  'scaffold_event',
] as const;

export type SkillScriptName = (typeof SKILL_SCRIPT_NAMES)[number];

function repoRoot(): string {
  // This file lives at <root>/src/tools/ (source) or <root>/dist/tools/ (build);
  // both resolve to the repository root three levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

/** Locate the directory holding the *.py helper scripts. */
export function resolveScriptsDir(): string {
  const fromEnv = process.env.RPGMAKER_SKILL_SCRIPTS;
  if (fromEnv && fs.existsSync(fromEnv) && fs.statSync(fromEnv).isDirectory()) {
    return fromEnv;
  }
  const candidates = [
    path.join(repoRoot(), '.claude', 'rpgmaker-scripts', 'scripts'),
    path.join(process.cwd(), '.claude', 'rpgmaker-scripts', 'scripts'),
    path.join(process.cwd(), 'rpgmaker-scripts', 'scripts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  throw new Error(
    'RPG Maker skill scripts not found. Install rpgmaker-agent-skills into ' +
    '<repo>/.claude/rpgmaker-scripts (or set RPGMAKER_SKILL_SCRIPTS to the scripts directory).'
  );
}

/** True if `script` is one of the allow-listed skill scripts. */
export function isAllowedSkillScript(script: string): script is SkillScriptName {
  return (SKILL_SCRIPT_NAMES as readonly string[]).includes(script);
}

function flagify(key: string): string {
  // itemId -> --item-id, switchId -> --switch-id, pattern -> --pattern
  const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
  return '--' + kebab;
}

function buildArgv(script: SkillScriptName, projectPath: string, args: Record<string, unknown>): string[] {
  // Every bundled script takes --project (scaffold_event uses it for MV/MZ detection).
  const argv: string[] = [script + '.py', '--project', projectPath];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const flag = flagify(key);
    if (typeof value === 'boolean') {
      if (value) argv.push(flag);
    } else if (Array.isArray(value)) {
      for (const item of value) argv.push(flag, String(item));
    } else {
      argv.push(flag, String(value));
    }
  }
  return argv;
}

export interface SkillScriptResult {
  script: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  report: string;
}

/** Run one allow-listed skill script and capture its output. */
export async function runSkillScript(
  script: SkillScriptName,
  projectPath: string,
  args: Record<string, unknown> = {}
): Promise<SkillScriptResult> {
  const scriptsDir = resolveScriptsDir();
  const scriptPath = path.join(scriptsDir, script + '.py');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Skill script "' + script + '.py" not found in ' + scriptsDir);
  }
  const argv = buildArgv(script, projectPath, args);
  const pythonPath = process.env.PYTHON || 'python';
  return new Promise<SkillScriptResult>((resolve, reject) => {
    const child = spawn(pythonPath, argv, {
      cwd: scriptsDir,
      env: Object.assign({}, process.env, { PYTHONPATH: path.dirname(scriptsDir) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += String(d); });
    child.stderr.on('data', (d: Buffer) => { stderr += String(d); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({
        script,
        exitCode: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        report: (stderr.trim() ? 'STDERR:\n' + stderr.trim() + '\n\n' : '') + stdout.trim(),
      });
    });
  });
}

/**
 * Consolidated-tool handler for `run_skill_script`. Accepts the raw
 * consolidated args object (script / args / project) plus the active project
 * path; coerces and validates internally.
 */
export async function runSkillScriptTool(args: Record<string, unknown>, projectPath: string): Promise<unknown> {
  const script = String(args.script ?? '');
  if (!isAllowedSkillScript(script)) {
    throw new Error('Unknown skill script "' + script + '". Allowed: ' + SKILL_SCRIPT_NAMES.join(', '));
  }
  const scriptArgs = args.args && typeof args.args === 'object' && !Array.isArray(args.args)
    ? args.args as Record<string, unknown>
    : {};
  const targetProject = typeof args.project === 'string' && args.project.length > 0 ? args.project : projectPath;
  const result = await runSkillScript(script, targetProject, scriptArgs);
  return {
    script: result.script,
    exitCode: result.exitCode,
    stderr: result.stderr,
    report: result.report,
  };
}
