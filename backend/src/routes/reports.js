import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import { sendReport, buildReport, smtpConfigured } from '../mailer.js';

const router = Router();

// GET /api/report-preview?since=ISO -> the report data (no email sent).
router.get('/report-preview', requireAuth, (req, res, next) => {
  try {
    const since = req.query.since || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    res.json({ smtpConfigured: smtpConfigured(), ...buildReport(req.userId, since) });
  } catch (err) {
    next(err);
  }
});

// POST /api/send-report-now -> email the current user their report immediately.
router.post('/send-report-now', requireAuth, async (req, res, next) => {
  try {
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.userId);
    const result = await sendReport(user, { since: req.body?.since });
    if (!result.sent) return res.status(400).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
