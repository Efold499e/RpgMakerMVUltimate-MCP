/**
 * skills.ts — loads the rpgmaker-agent-skills pack into the system context.
 *
 * The pack lives at <repo>/.claude/skills (installed by the repo setup) or
 * anywhere RPGMAKER_SKILLS_DIR points to. We surface every rpgmaker-* SKILL.md
 * plus the two shared references that matter most for authoring (event command
 * codes and text escape codes), bounded to MAX_CONTEXT_CHARS so the system
 * prompt never blows past the model's window.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MAX_CONTEXT_CHARS = 100_000;

function repoRoot(): string {
  // <repo>/tools/deepseek-mv/src (dev) or <repo>/tools/deepseek-mv/dist (build) -> three levels up
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

/** Locate the skills directory; returns '' when not found. */
export function skillsDir(): string {
  const fromEnv = process.env.RPGMAKER_SKILLS_DIR;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    path.join(repoRoot(), '.claude', 'skills'),
    path.join(process.cwd(), '.claude', 'skills'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

/** Build the condensed skills context block for the system prompt. */
export function buildSkillsContext(): string {
  const dir = skillsDir();
  if (!dir) return '';

  const sections: string[] = [];
  let total = 0;

  const push = (label: string, filePath: string): void => {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf-8');
    sections.push('\n===== ' + label + ' =====\n' + content);
    total += content.length;
  };

  // 1) Every rpgmaker-* skill's SKILL.md (the operative guidance).
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('rpgmaker-')) continue;
    push('SKILL: ' + entry.name, path.join(dir, entry.name, 'SKILL.md'));
  }

  // 2) The two shared references most useful while authoring events.
  const sharedRefs = path.join(dir, 'shared', 'references');
  push('REFERENCE: event-command-codes.md', path.join(sharedRefs, 'event-command-codes.md'));
  push('REFERENCE: text-codes.md', path.join(sharedRefs, 'text-codes.md'));

  let out = sections.join('\n');
  if (out.length > MAX_CONTEXT_CHARS) {
    out = out.slice(0, MAX_CONTEXT_CHARS) + '\n... [skills context truncated]';
  }
  return out;
}
