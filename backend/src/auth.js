// License check -> JWT. The extension stores the JWT and sends it as a Bearer
// token on every request. Minimal but real.

import jwt from 'jsonwebtoken';
import { db, getOrCreateUser } from './db.js';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s === 'change-me-to-a-long-random-string') {
    // Don't crash, but make it loud in logs.
    console.warn('[auth] JWT_SECRET is unset or default. Set a real secret in .env for production.');
  }
  return s || 'insecure-dev-secret';
}

export function issueToken(user) {
  return jwt.sign({ uid: user.id }, secret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

// Validates a license key, creates/links a user, returns { token, user }.
export function checkLicense({ key, email = null, linkedinUrl = null }) {
  if (!key || typeof key !== 'string' || key.trim().length < 6) {
    throw Object.assign(new Error('A valid license key is required'), { status: 400 });
  }
  const trimmed = key.trim();
  let lic = db.prepare('SELECT * FROM licenses WHERE key = ?').get(trimmed);

  // For a self-hosted single-user setup, auto-provision an active license the
  // first time a key is seen. In a real SaaS you would seed licenses out of band
  // and remove this block.
  if (!lic) {
    db.prepare('INSERT INTO licenses (key, status) VALUES (?, ?)').run(trimmed, 'active');
    lic = db.prepare('SELECT * FROM licenses WHERE key = ?').get(trimmed);
  }
  if (lic.status !== 'active') {
    throw Object.assign(new Error('License is not active'), { status: 403 });
  }

  const user = getOrCreateUser({ email, linkedinUrl });
  if (!lic.user_id) {
    db.prepare('UPDATE licenses SET user_id = ? WHERE key = ?').run(user.id, trimmed);
  }
  return { token: issueToken(user), user };
}

// Express middleware: requires a valid Bearer token, attaches req.userId.
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(m[1], secret());
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
