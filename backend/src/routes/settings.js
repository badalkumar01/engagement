import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getSettings, saveSettings, db } from '../db.js';

const router = Router();
const FILL_MODES = ['queue', 'autofill', 'clipboard'];

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// GET /api/get-settings -> settings
router.get('/get-settings', requireAuth, (req, res, next) => {
  try {
    res.json(getSettings(req.userId));
  } catch (err) {
    next(err);
  }
});

// POST /api/save-settings  { ...patch } -> settings
router.post('/save-settings', requireAuth, (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.tone !== undefined && !['friendly', 'professional'].includes(b.tone)) {
      return res.status(400).json({ error: 'tone must be friendly or professional' });
    }
    if (b.fillMode !== undefined && !FILL_MODES.includes(b.fillMode)) {
      return res.status(400).json({ error: 'fillMode must be queue, autofill, or clipboard' });
    }
    for (const key of ['keywords', 'industries', 'targetProfiles']) {
      if (b[key] !== undefined && !isStringArray(b[key])) {
        return res.status(400).json({ error: `${key} must be an array of strings` });
      }
    }
    if (b.links !== undefined && (!Array.isArray(b.links) || b.links.some(
      (link) => !link || typeof link.label !== 'string' || typeof link.url !== 'string'
    ))) {
      return res.status(400).json({ error: 'links must be an array of { label, url } objects' });
    }
    if (b.guideline !== undefined && (typeof b.guideline !== 'string' || b.guideline.length > 5000)) {
      return res.status(400).json({ error: 'guideline must be a string up to 5000 characters' });
    }
    if (b.platforms !== undefined && (!Array.isArray(b.platforms) ||
        b.platforms.some((p) => !['linkedin', 'instagram'].includes(p)))) {
      return res.status(400).json({ error: 'platforms must be an array of "linkedin"/"instagram"' });
    }
    if (b.emailReports !== undefined && typeof b.emailReports !== 'boolean') {
      return res.status(400).json({ error: 'emailReports must be a boolean' });
    }
    // Allow updating the user's linkedin url alongside settings.
    if (b.linkedinUrl !== undefined && typeof b.linkedinUrl !== 'string') {
      return res.status(400).json({ error: 'linkedinUrl must be a string' });
    }
    if (typeof b.linkedinUrl === 'string') {
      db.prepare('UPDATE users SET linkedin_url = ? WHERE id = ?').run(b.linkedinUrl, req.userId);
    }
    const patch = {};
    for (const k of ['tone', 'links', 'keywords', 'industries', 'targetProfiles', 'guideline', 'fillMode', 'reviewBefore', 'platforms', 'emailReports']) {
      if (k in b) patch[k] = b[k];
    }
    res.json(saveSettings(req.userId, patch));
  } catch (err) {
    next(err);
  }
});

export default router;
