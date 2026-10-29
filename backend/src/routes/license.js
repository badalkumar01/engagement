import { Router } from 'express';
import { checkLicense } from '../auth.js';

const router = Router();

// POST /api/license-check  { key, email?, linkedinUrl? } -> { token, user }
router.post('/license-check', (req, res, next) => {
  try {
    const { key, email, linkedinUrl } = req.body || {};
    const { token, user } = checkLicense({ key, email, linkedinUrl });
    res.json({ token, user: { id: user.id, email: user.email, linkedinUrl: user.linkedin_url } });
  } catch (err) {
    next(err);
  }
});

export default router;
