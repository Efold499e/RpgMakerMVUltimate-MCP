/**
 * mcp.ts — MCP client that spawns the rpgmaker-mv-mcp server over stdio and
 * exposes its tools to the agent loop.
 *
 * The server is auto-located: RPGMAKER_MCP_SERVER env override, then the fork's
 * built dist/index.js, then the cwd's dist/index.js, then `rpgmaker-mv-mcp` on
 * PATH. The active project is injected via RPGMAKER_PROJECT_PATH so the server
 * is ready to use immediately.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpHandle {
  tools: McpToolSpec[];
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}

function repoRoot(): string {
  // <repo>/tools/deepseek-mv/src (dev) or <repo>/tools/deepseek-mv/dist (build) -> three levels up
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

export function defaultServerPath(): string {
  const fromEnv = process.env.RPGMAKER_MCP_SERVER;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    path.join(repoRoot(), 'dist', 'index.js'),
    path.join(process.cwd(), 'dist', 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'rpgmaker-mv-mcp';
}

export async function connectMcp(projectPath: string, serverPath?: string): Promise<McpHandle> {
  const server = serverPath || defaultServerPath();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.RPGMAKER_PROJECT_PATH = projectPath;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env,
  });
  const client = new Client({ name: 'deepseek-mv', version: '0.1.0' });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: McpToolSpec[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  return {
    tools,
    call: async (name, args) => {
      const res = (await client.callTool({ name, arguments: args })) as {
        content?: Array<{ type?: string; text?: string }>;
        structuredContent?: unknown;
      };
      const parts = (res.content || [])
        .filter((c) => c && c.type === 'text')
        .map((c) => c.text || '');
      return parts.join('\n') || JSON.stringify(res.structuredContent ?? '');
    },
    close: async () => {
      await client.close();
    },
  };
}
