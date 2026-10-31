// Shared drafting logic used by every LLM provider: category definitions,
// the hard style rules, prompt construction, and the output sanitizer.
// Providers (claude.js, gemini.js) only implement the HTTP call.

export const CATEGORIES = {
  question:
    'A genuine, specific reaction to the post, then one open-ended question that invites the author to say more. The question is the point.',
  appreciation:
    'Warm, specific appreciation for one concrete thing in the post, plus a light forward-looking line (e.g. looking forward to more on this).',
  relatable:
    'A short relatable experience or the commenter\'s own view on the specific point the post makes.',
  value_add:
    'One complementary insight or concrete example that genuinely extends the post, without talking over the author.',
};

// Hard style rules baked into every draft.
const STYLE_RULES = `
Hard rules for the comment:
- Be specific to THIS post. Reference the actual point the author made. Never generic.
- Never open with "Great post", "Amazing share", "Love this", or similar filler.
- Vary length between 1 and 3 short lines. Sometimes drop the question entirely.
- Vary the opener; do not reuse the same sentence shape every time.
- No em dashes anywhere. Use commas, periods, or separate sentences instead.
- No hashtags.
- Do not pitch, sell, or paste any links. The commenter's own links are context only.
- Sound like a real person leaving a quick, thoughtful comment, not like marketing copy.
- React ONLY to the real subject of the post. NEVER mention the caption, the lack of a caption,
  the platform, the app, the image quality, or that any information is missing. Never make meta
  jokes (for example about a "blank caption", "Instagram playing tricks", or a caption "taking a day off").
- If text appears on the image or video frame, that text is usually the post's actual message, so
  respond to what it says.
- If the post is about something personal or sensitive (a health condition such as PCOS, mental
  health, anxiety, grief, body image, a hard experience), be genuinely warm and empathetic and
  specific to that topic. Never be flippant, jokey, or dismissive about it.
- Avoid vague filler like "cozy vibe", "photo layout", "love the aesthetic", "this is everything"
  unless it is concretely and obviously true of what you can actually see.
Output exactly ONE comment. Do not offer multiple options, numbered ideas (e.g. "Idea 1"),
headings, labels, or any markdown. Return ONLY the comment text, with no quotes, preamble, or explanation.`;

export function buildSystemPrompt(settings, avoid = []) {
  const tone = settings.tone === 'professional' ? 'professional' : 'friendly';
  const base =
    settings.guideline?.trim() ||
    `You help a social media user write short, authentic engagement comments in their own voice.`;

  const context = [];
  if (settings.industries?.length) context.push(`Industries they care about: ${settings.industries.join(', ')}.`);
  if (settings.keywords?.length) context.push(`Topics/keywords: ${settings.keywords.join(', ')}.`);
  if (settings.links?.length) {
    const labels = settings.links.map((l) => l.label || l.url).filter(Boolean);
    if (labels.length) context.push(`They have these assets for context only, never to be mentioned in comments: ${labels.join(', ')}.`);
  }

  let system = `${base}

Tone: ${tone}.
${context.join('\n')}
${STYLE_RULES}`;

  if (avoid.length) {
    system += `\n\nDo NOT write anything close to these recent comments; produce something clearly different:\n- ${avoid
      .slice(0, 8)
      .map((a) => a.replace(/\s+/g, ' ').slice(0, 200))
      .join('\n- ')}`;
  }
  return system;
}

const PLATFORM_STYLE = {
  linkedin: 'This is for LinkedIn: a professional network. A couple of thoughtful sentences is normal.',
  instagram: 'This is for Instagram: casual and concise. Keep it to one short line or two. A fitting emoji is fine but optional, never more than one.',
};

const TYPE_NOTE = {
  carousel: 'This is a multi-image carousel post. The attached images are its slides, in order.',
  video: 'This is a video post. The attached image is the video\'s cover frame, so treat it as a still from the video, not the whole thing.',
  static: 'This is a single-image post. The attached image is that image.',
};

export function buildUserPrompt({ category, postText, postAuthor, platform, postType, hasImages }) {
  const catSpec = CATEGORIES[category] || CATEGORIES.question;
  const platformLine = PLATFORM_STYLE[platform] || PLATFORM_STYLE.linkedin;

  const visual = [];
  if (hasImages) {
    visual.push(TYPE_NOTE[postType] || 'One or more images from the post are attached.');
    visual.push('Look closely at the image(s), INCLUDING any text written on them, and make the comment specific to what is actually shown and what that text says. Do not describe the image back; react to it like a thoughtful person would.');
  }
  // Very little to go on: keep it safe and sincere, never improvise about missing info.
  const thinText = (postText || '').trim().length < 15;
  if (thinText && !hasImages) {
    visual.push('You have very little to work with. Do NOT invent specifics and do NOT comment on the caption or the app in any way. Write one short, sincere, warm line that fits the author\'s apparent topic. If you genuinely cannot tell the topic at all, respond with a single word of the sentinel: SKIP');
  }

  return `Write one ${category} comment.

${platformLine}
${visual.join('\n')}

Category intent: ${catSpec}

Post author / handle: ${postAuthor || 'unknown'}
Post caption:
"""
${(postText || '').slice(0, 4000)}
"""`;
}

// Belt-and-suspenders: strip anything the style rules forbid even if the model
// slips (markdown, a leading preamble, an "Idea N:" label). It never drops the
// actual comment, and leaves already-clean text untouched.
const PREAMBLE = /^(sure|certainly|of course|here(?:'s| is| are)\b.*?|comment)\s*[:!.]*$/i;
const LABEL = /^(?:idea|option|draft|version|comment)\s*#?\d*\s*[:.)\-]\s*/i;

export function sanitize(text) {
  let out = (text || '')
    .replace(/—/g, ', ')          // em dash -> comma
    .replace(/–/g, '-')           // en dash -> hyphen
    .replace(/\*/g, '')           // markdown bold/italic/bullet asterisks
    .replace(/^#{1,6}\s+/gm, '')  // markdown headings
    .replace(/#\w+/g, '');        // hashtags

  let lines = out.split('\n').map((l) => l.trim());
  // Drop leading blank lines and lead-in lines: an explicit preamble, or any
  // short line ending in a colon (a real comment is not a short colon-terminated line).
  const isLeadIn = (l) => l === '' || PREAMBLE.test(l) || (/:$/.test(l) && l.length <= 40);
  while (lines.length > 1 && isLeadIn(lines[0])) lines.shift();
  // Strip an "Idea 3:" / "Option 2:" style label from the first real line.
  if (lines.length) lines[0] = lines[0].replace(LABEL, '');

  out = lines
    .join('\n')
    .replace(/^["'\s]+|["'\s]+$/g, '') // surrounding quotes/space
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}
