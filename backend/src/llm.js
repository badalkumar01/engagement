// Provider dispatcher. Set LLM_PROVIDER in .env to 'gemini' or 'claude'.
// The rest of the app imports draftComment + CATEGORIES from here and does not
// care which provider is active.

import { draftComment as claudeDraft } from './claude.js';
import { draftComment as geminiDraft } from './gemini.js';
import { CATEGORIES } from './prompt.js';

const PROVIDERS = { claude: claudeDraft, gemini: geminiDraft };

export function activeProvider() {
  return (process.env.LLM_PROVIDER || 'claude').toLowerCase();
}

export async function draftComment(args) {
  const name = activeProvider();
  const fn = PROVIDERS[name];
  if (!fn) {
    throw Object.assign(new Error(`Unknown LLM_PROVIDER "${name}". Use "gemini" or "claude".`), { status: 500 });
  }
  return fn(args);
}

export { CATEGORIES };
