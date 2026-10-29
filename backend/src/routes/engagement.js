import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import { findNearDuplicate, normalize } from '../dedup.js';

const router = Router();
const ALLOWED_STATUSES = ['drafted', 'posted', 'skipped'];

router.get('/review-queue', requireAuth, (req, res, next) => {
  try {
    const drafts = db
      .prepare(
        `SELECT id, post_url, surface, category, platform, comment, created_at
           FROM engagement_log
          WHERE user_id = ? AND status = 'drafted'
          ORDER BY id DESC
          LIMIT 100`
      )
      .all(req.userId);
    res.json({ drafts });
  } catch (err) {
    next(err);
  }
});

router.post('/update-draft', requireAuth, (req, res, next) => {
  try {
    const { id, comment } = req.body || {};
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) {
      return res.status(400).json({ error: 'id must be a positive integer' });
    }
    if (typeof comment !== 'string' || !comment.trim() || comment.length > 2000) {
      return res.status(400).json({ error: 'comment must contain 1 to 2000 characters' });
    }

    const row = db
      .prepare('SELECT id FROM engagement_log WHERE id = ? AND user_id = ? AND status = ?')
      .get(id, req.userId, 'drafted');
    if (!row) return res.status(404).json({ error: 'Draft not found or already resolved' });

    const prior = db
      .prepare('SELECT comment FROM engagement_log WHERE user_id = ? AND id != ?')
      .all(req.userId, id)
      .map((entry) => entry.comment);
    const duplicate = findNearDuplicate(comment, prior, 0.7);
    if (duplicate) {
      return res.status(409).json({ error: 'This edit is too similar to another recent comment' });
    }

    db.prepare(
      'UPDATE engagement_log SET comment = ?, comment_norm = ? WHERE id = ? AND user_id = ? AND status = ?'
    ).run(comment.trim(), normalize(comment), id, req.userId, 'drafted');
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

// POST /api/log-engagement
//   { id?, postUrl?, surface?, category?, comment?, status }
// Marks a drafted comment as posted/skipped (by id), or inserts a standalone
// record if no id is given. The extension calls this after the USER posts.
router.post('/log-engagement', requireAuth, (req, res, next) => {
  try {
    const { id, postUrl, surface, category, comment, status } = req.body || {};
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'status must be drafted, posted, or skipped' });
    }

    if (id) {
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) {
        return res.status(400).json({ error: 'id must be a positive integer' });
      }
      const row = db.prepare('SELECT id, status FROM engagement_log WHERE id = ? AND user_id = ?').get(id, req.userId);
      if (!row) return res.status(404).json({ error: 'Log entry not found' });
      if (row.status !== 'drafted') {
        return res.status(409).json({ error: 'Only drafted comments can be updated' });
      }
      db.prepare('UPDATE engagement_log SET status = ? WHERE id = ? AND user_id = ?').run(status, id, req.userId);
      return res.json({ ok: true, id });
    }

    if (typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({ error: 'comment or id is required' });
    }
    const info = db
      .prepare(
        `INSERT INTO engagement_log (user_id, post_url, surface, category, comment, comment_norm, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.userId, postUrl || null, surface || null, category || null, comment, comment.toLowerCase(), status);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

// GET /api/session-summary?since=ISO  -> totals by surface/category + list
// Defaults to "today" (local server day).
router.get('/session-summary', requireAuth, (req, res, next) => {
  try {
    const since = req.query.since || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const rows = db
      .prepare(
        `SELECT id, post_url, surface, category, platform, comment, status, created_at
           FROM engagement_log
          WHERE user_id = ? AND created_at >= ? AND status = 'posted'
          ORDER BY id DESC`
      )
      .all(req.userId, since.replace('T', ' ').slice(0, 19));

    const bySurface = {};
    const byCategory = {};
    const byPlatform = {};
    for (const r of rows) {
      if (r.surface) bySurface[r.surface] = (bySurface[r.surface] || 0) + 1;
      if (r.category) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      if (r.platform) byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1;
    }

    res.json({ since, total: rows.length, bySurface, byCategory, byPlatform, posts: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
