// Gemini drafting provider (Google Generative Language API). The API key stays
// on the server. The model id comes from .env so it is swappable.

import { buildSystemPrompt, buildUserPrompt, sanitize } from './prompt.js';

export async function draftComment({ settings, category, postText, postAuthor, platform, avoid = [] }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY is not set on the server'), { status: 500 });

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const maxTokens = Number(process.env.GEMINI_MAX_TOKENS || 800);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature: 0.9,
    responseMimeType: 'text/plain',
  };
  // "thinking" control is only supported on some models and 400s on the fast
  // "lite" models, so it is opt-in via GEMINI_THINKING=true (for thinking models
  // where you want to cap the thinking budget).
  if (String(process.env.GEMINI_THINKING || 'false') === 'true') {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const body = {
    systemInstruction: { parts: [{ text: buildSystemPrompt(settings, avoid) }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt({ category, postText, postAuthor, platform }) }] }],
    generationConfig,
  };

  // Retry transient upstream errors (rate limit / overloaded) with backoff.
  const RETRYABLE = new Set([429, 503]);
  const maxAttempts = Number(process.env.GEMINI_RETRIES || 3);
  let res;
  let lastDetail = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 30000)),
      });
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'Gemini request timed out' : 'Could not reach Gemini API';
      throw Object.assign(new Error(message), { status: 502 });
    }

    if (res.ok) break;

    lastDetail = await res.text().catch(() => '');
    if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1))); // 400ms, 800ms, ...
      continue;
    }
    const hint = res.status === 503 ? ' (model busy, try again shortly)' : '';
    // Keep the key out of any surfaced error text.
    throw Object.assign(new Error(`Gemini API error ${res.status}${hint}: ${lastDetail.slice(0, 300)}`), { status: 502 });
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') {
    throw Object.assign(new Error('Gemini blocked this draft on safety grounds. Try a different post or category.'), { status: 502 });
  }
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  const comment = sanitize(text);
  if (!comment) throw Object.assign(new Error('Gemini returned an empty comment'), { status: 502 });
  return comment;
}
