#!/usr/bin/env node
/**
 * deepseek-mv — a DeepSeek-powered agent CLI for RPG Maker MV.
 *
 * Based on the rpgmaker-mv-mcp server (project #2): the agent drives its MCP
 * tools against a real RPG Maker MV project. It loads the rpgmaker-agent-skills
 * pack (project #3) into the system prompt so edits follow the engine's safety
 * rules, and supports multimodal image input through DeepSeek's vision model
 * (deepseek-v4-flash-vision-exp).
 *
 * Usage:
 *   node dist/index.js "Describe an NPC for Map003" --project <path>
 *   node dist/index.js "What is in this screenshot?" --image shot.png --project <path>
 *
 * Config comes from tools/deepseek-mv/.env (or the environment):
 *   DEEPSEEK_API_KEY=sk-...            (required)
 *   DEEPSEEK_MODEL=deepseek-v4-flash   (text default)
 *   DEEPSEEK_VISION_MODEL=deepseek-v4-flash-vision-exp
 *   RPGMAKER_PROJECT_PATH=<project>    (or --project)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectMcp, defaultServerPath } from './mcp.js';
import { buildSkillsContext } from './skills.js';
import { chatCompletion, type DeepSeekMessage } from './deepseek.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  const candidates = [
    process.env.DEEPSEEK_ENV_FILE,
    path.join(process.cwd(), '.env'),
    path.join(HERE, '..', '.env'),
  ].filter((x): x is string => !!x);
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        process.loadEnvFile(file);
        return;
      } catch {
        /* ignore malformed .env; fall through to next candidate */
      }
    }
  }
}

interface CliOptions {
  prompt: string;
  project?: string;
  image?: string;
  model?: string;
  visionModel?: string;
  maxSteps: number;
  noTools: boolean;
  noSkills: boolean;
  printContext: boolean;
  help: boolean;
  thinking: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: Record<string, string | boolean | undefined> = {};
  const positionals: string[] = [];
  // kebab-case -> camelCase (--max-steps -> maxSteps, --print-context -> printContext)
  const normalize = (key: string): string => key.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = normalize(arg.slice(2));
      const eq = key.indexOf('=');
      if (eq >= 0) {
        opts[key.slice(0, eq)] = key.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          opts[key] = next;
          i++;
        } else {
          opts[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return {
    prompt: (typeof opts.prompt === 'string' ? opts.prompt : positionals.join(' ')).trim(),
    project: typeof opts.project === 'string' ? opts.project : undefined,
    image: typeof opts.image === 'string' ? opts.image : undefined,
    model: typeof opts.model === 'string' ? opts.model : undefined,
    visionModel: typeof opts.visionModel === 'string' ? opts.visionModel : undefined,
    maxSteps: Number(opts.maxSteps || process.env.DEEPSEEK_MAX_STEPS || 10),
    noTools: opts.noTools === true || process.env.DEEPSEEK_NO_TOOLS === '1',
    noSkills: opts.noSkills === true,
    printContext: opts.printContext === true,
    help: opts.help === true || opts.h === true,
    thinking: opts.thinking === true || process.env.DEEPSEEK_THINKING === '1',
  };
}

function imageDataUrl(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
    : ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp'
    : 'image/jpeg';
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}

const USAGE = `deepseek-mv — DeepSeek agent for RPG Maker MV

Usage:
  node dist/index.js <prompt> [options]
  node dist/index.js --prompt "<prompt>" [options]

Options:
  --project <path>    RPG Maker MV project root (default: $RPGMAKER_PROJECT_PATH or cwd)
  --image <path>      Attach an image (JPEG/PNG/GIF/WebP) and use the vision model
  --model <name>      Text model (default: $DEEPSEEK_MODEL or deepseek-v4-flash)
  --vision-model <n>  Vision model (default: $DEEPSEEK_VISION_MODEL or deepseek-v4-flash-vision-exp)
  --max-steps <n>     Max agent loop iterations (default 10)
  --no-tools          Chat only; do not connect the MCP server
  --no-skills         Omit the rpgmaker-agent-skills context
  --thinking          Enable thinking mode
  --print-context     Print the assembled skills context and exit
  --help              Show this help

Examples:
  node dist/index.js "List the skills in this project and suggest a fire spell" --project D:\\Games\\MyGame
  node dist/index.js "Describe this map screenshot" --image shot.png --project D:\\Games\\MyGame
  node dist/index.js "Check the project for broken references" --project D:\\Games\\MyGame
`;

async function main(): Promise<void> {
  loadEnv();
  const cli = parseArgs(process.argv.slice(2));

  if (cli.help) {
    process.stdout.write(USAGE);
    return;
  }

  const skills = buildSkillsContext();
  if (cli.printContext) {
    process.stdout.write(skills || '(no skills found)');
    return;
  }
  if (!cli.prompt) {
    process.stderr.write('Error: no prompt given.\n\n' + USAGE);
    process.exit(1);
  }

  const model = cli.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const visionModel = cli.visionModel || process.env.DEEPSEEK_VISION_MODEL || 'deepseek-v4-flash-vision-exp';
  const projectPath = cli.project || process.env.RPGMAKER_PROJECT_PATH || process.cwd();
  const useVision = !!cli.image;
  const activeModel = useVision ? visionModel : model;

  const systemParts = [
    'You are an expert RPG Maker MV development assistant.',
    'You operate on a real RPG Maker MV project through MCP tools (query_database, query_map, generate_map, edit_map, manage_map_event, manage_system, analyze_project, run_skill_script, ...).',
    'Project path: ' + projectPath,
    '',
    'RPG Maker safety rules you must follow (from the rpgmaker-agent-skills pack):',
    '- data/*.json index 0 is null; new entries get the next free ID; never renumber existing IDs.',
    '- MapInfos.json is append-only; never reorder or renumber entries.',
    '- Dry-run / prefer read-only tools first: query_database, query_map, analyze_project, run_skill_script checkers.',
    '- Always confirm referenced IDs (classId, stateId, enemyIds, itemId...) with query_database before writing.',
    '- Every write you propose is a DRAFT for the developer to review; never mutate without good reason.',
    '- After edits, consider run_skill_script script=validate_project to check consistency.',
    '',
  ];
  if (!cli.noSkills) {
    systemParts.push('=== RPG Maker agent skills context ===');
    systemParts.push(skills || '(no rpgmaker-agent-skills found in the repo)');
  } else {
    systemParts.push('(skills context omitted per --no-skills)');
  }

  const system = systemParts.join('\n');

  let mcp: Awaited<ReturnType<typeof connectMcp>> | undefined;
  if (!cli.noTools) {
    const serverPath = defaultServerPath();
    mcp = await connectMcp(projectPath, serverPath);
    process.stderr.write('[deepseek-mv] connected to ' + mcp.tools.length + ' MCP tools via ' + serverPath + '\n');
  }

  const tools = mcp
    ? mcp.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
        },
      }))
    : undefined;

  const userContent: string | Array<Record<string, unknown>> = useVision
    ? [
        { type: 'text', text: cli.prompt },
        { type: 'image_url', image_url: { url: imageDataUrl(cli.image!) } },
      ]
    : cli.prompt;

  const messages: DeepSeekMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ];

  let finalText = '';
  for (let step = 0; step < cli.maxSteps; step++) {
    const resp = await chatCompletion({
      model: activeModel,
      messages,
      tools,
      thinking: cli.thinking,
    });
    const msg = resp.choices[0].message;

    if (msg.tool_calls && msg.tool_calls.length > 0 && mcp) {
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = { raw: tc.function.arguments };
        }
        process.stderr.write('\n[tool ' + (step + 1) + '] ' + tc.function.name + ' ' + JSON.stringify(args) + '\n');
        let out: string;
        try {
          out = await mcp.call(tc.function.name, args);
        } catch (err) {
          out = 'Tool error: ' + (err instanceof Error ? err.message : String(err));
        }
        process.stderr.write('[tool result] ' + (out.length > 3000 ? out.slice(0, 3000) + '…(truncated)' : out) + '\n');
        messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
      }
      continue;
    }

    finalText = msg.content || '';
    break;
  }

  process.stdout.write('\n' + finalText + '\n');
  if (mcp) {
    await mcp.close();
  }
}

main().catch(function (err) {
  process.stderr.write('Error: ' + (err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
});
