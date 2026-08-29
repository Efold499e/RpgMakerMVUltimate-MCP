/**
 * deepseek.ts — minimal OpenAI-compatible client for the DeepSeek API.
 *
 * Base URL defaults to https://api.deepseek.com (Chat Completions). Function
 * calling uses the standard `tools` / `tool_choice` / `tool_calls` contract.
 * Set DEEPSEEK_API_URL to point at a compatible proxy if needed.
 */

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>>;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface ChatOptions {
  model: string;
  messages: DeepSeekMessage[];
  tools?: unknown[];
  maxTokens?: number;
  thinking?: boolean;
}

export function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      'DEEPSEEK_API_KEY is not set. Create tools/deepseek-mv/.env with DEEPSEEK_API_KEY=sk-... ' +
      'or export it in your shell.'
    );
  }
  return key;
}

export async function chatCompletion(opts: ChatOptions): Promise<any> {
  const base = (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = base + '/chat/completions';

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.thinking) body.thinking = { type: 'enabled' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey(),
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    const detail = json && json.error ? JSON.stringify(json.error) : JSON.stringify(json);
    throw new Error('DeepSeek API error ' + res.status + ': ' + detail);
  }
  return json;
}
