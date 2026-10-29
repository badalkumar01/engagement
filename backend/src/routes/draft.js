import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getSettings, db } from '../db.js';
import { draftComment, CATEGORIES } from '../llm.js';
import { normalize, findNearDuplicate } from '../dedup.js';

const router = Router();

// Weighted category picker: questions ~50%, the rest split.
const WEIGHTED = [
  ...Array(5).fill('question'),
  ...Array(2).fill('appreciation'),
  ...Array(2).fill('relatable'),
  ...Array(2).fill('value_add'),
];
function pickCategory(requested) {
  if (requested && CATEGORIES[requested]) return requested;
  return WEIGHTED[Math.floor(Math.random() * WEIGHTED.length)];
}

// POST /api/draft-comment
//   { postText, postAuthor?, postUrl?, surface?, category? }
//   -> { comment, category, surface }
// Drafts a comment for the user to review and post themselves. Rejects
// near-duplicates of the user's recent comments by regenerating.
router.post('/draft-comment', requireAuth, async (req, res, next) => {
  try {
    const { postText, postAuthor, postUrl, surface, category, platform } = req.body || {};
    if (!postText || typeof postText !== 'string' || postText.trim().length < 10) {
      return res.status(400).json({ error: 'postText is required (the content of the post to react to)' });
    }

    const settings = getSettings(req.userId);
    const chosen = pickCategory(category);
    const plat = ['linkedin', 'instagram'].includes(platform) ? platform : 'linkedin';

    // Pull recent comments to avoid repeating ourselves.
    const prior = db
      .prepare('SELECT comment FROM engagement_log WHERE user_id = ? ORDER BY id DESC LIMIT 40')
      .all(req.userId)
      .map((r) => r.comment);

    let comment = null;
    let dupe = null;
    const MAX_TRIES = 3;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const candidate = await draftComment({
        settings,
        category: chosen,
        postText,
        postAuthor,
        platform: plat,
        avoid: prior,
      });
      dupe = findNearDuplicate(candidate, prior, 0.7);
      if (!dupe) {
        comment = candidate;
        break;
      }
      // feed the dupe back so the next attempt steers away from it
      prior.unshift(candidate);
    }

    if (!comment) {
      return res.status(409).json({
        error: 'Could not produce a sufficiently unique comment after several tries. Try a different post or category.',
        lastSimilarity: dupe?.score,
      });
    }

    // Recheck after the Claude request completes so concurrent draft requests
    // cannot both pass the earlier duplicate check.
    const latest = db
      .prepare('SELECT comment FROM engagement_log WHERE user_id = ? ORDER BY id DESC LIMIT 40')
      .all(req.userId)
      .map((r) => r.comment);
    const concurrentDuplicate = findNearDuplicate(comment, latest, 0.7);
    if (concurrentDuplicate) {
      return res.status(409).json({
        error: 'A similar comment was just drafted. Try a different post or category.',
        lastSimilarity: concurrentDuplicate.score,
      });
    }

    // Record as a draft so it counts toward dedup even before the user posts.
    const info = db
      .prepare(
        `INSERT INTO engagement_log (user_id, post_url, surface, category, platform, comment, comment_norm, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'drafted')`
      )
      .run(req.userId, postUrl || null, surface || null, chosen, plat, comment, normalize(comment));

    res.json({ id: info.lastInsertRowid, comment, category: chosen, surface: surface || null, platform: plat });
  } catch (err) {
    next(err);
  }
});

export default router;
