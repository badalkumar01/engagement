// Claude drafting provider. The API key stays on the server. The model id comes
// from .env so it is swappable without code changes.

import { buildSystemPrompt, buildUserPrompt, sanitize } from './prompt.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export async function draftComment({ settings, category, postText, postAuthor, platform, avoid = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set on the server'), { status: 500 });

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  const maxTokens = Number(process.env.CLAUDE_MAX_TOKENS || 400);
  const system = buildSystemPrompt(settings, avoid);

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: buildUserPrompt({ category, postText, postAuthor, platform }) }],
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || process.env.CLAUDE_TIMEOUT_MS || 30000)),
    });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'Claude request timed out' : 'Could not reach Claude API';
    throw Object.assign(new Error(message), { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`Claude API error ${res.status}: ${detail.slice(0, 500)}`), { status: 502 });
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const comment = sanitize(text);
  if (!comment) throw Object.assign(new Error('Claude returned an empty comment'), { status: 502 });
  return comment;
}
