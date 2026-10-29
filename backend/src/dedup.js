// Near-duplicate detection so the same (or barely-changed) comment never gets
// drafted twice. Used before returning a draft and recorded in engagement_log.

export function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')   // drop urls
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')  // drop punctuation/emoji
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return new Set(normalize(text).split(' ').filter(Boolean));
}

// Jaccard similarity on word sets. Cheap, dependency-free, good enough to catch
// "same comment reworded slightly".
export function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union;
}

// Returns the closest prior comment above the threshold, or null.
export function findNearDuplicate(candidate, priorComments, threshold = 0.7) {
  let best = null;
  let bestScore = 0;
  for (const prior of priorComments) {
    const score = similarity(candidate, prior);
    if (score > bestScore) {
      bestScore = score;
      best = prior;
    }
  }
  return bestScore >= threshold ? { text: best, score: bestScore } : null;
}
