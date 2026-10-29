// SQLite setup + schema. Minimal data model:
//   users, settings, engagement_log, licenses.
// (No warm-up / pacing / auto-post state is stored, by design: the user posts
//  every comment themselves, so there is no scheduler state to persist.)

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = resolve(__dirname, '..', process.env.DB_PATH || './data/app.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE,
    linkedin_url  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tone            TEXT    NOT NULL DEFAULT 'friendly',   -- 'friendly' | 'professional'
    links           TEXT    NOT NULL DEFAULT '[]',          -- JSON: [{label,url}] (context only, never spammed)
    keywords        TEXT    NOT NULL DEFAULT '[]',          -- JSON: string[]
    industries      TEXT    NOT NULL DEFAULT '[]',          -- JSON: string[]
    target_profiles TEXT    NOT NULL DEFAULT '[]',          -- JSON: string[] of profile URLs
    guideline       TEXT    NOT NULL DEFAULT '',            -- the drafting system-prompt template
    fill_mode       TEXT    NOT NULL DEFAULT 'queue',       -- 'queue' | 'autofill' | 'clipboard' (never auto-posts)
    review_before   INTEGER NOT NULL DEFAULT 1,             -- kept for UI; user always posts manually anyway
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS engagement_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_url    TEXT,
    surface     TEXT,     -- 'home' | 'search' | 'profile' | 'own_post'
    category    TEXT,     -- 'question' | 'appreciation' | 'relatable' | 'value_add'
    comment     TEXT NOT NULL,
    comment_norm TEXT NOT NULL,  -- normalized text, used for near-duplicate detection
    status      TEXT NOT NULL DEFAULT 'drafted', -- 'drafted' | 'posted' | 'skipped'
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_log_user ON engagement_log(user_id, created_at);

  CREATE TABLE IF NOT EXISTS licenses (
    key         TEXT PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'active', -- 'active' | 'revoked'
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Lightweight migrations for databases created before these columns -----
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing('engagement_log', 'platform', "TEXT NOT NULL DEFAULT 'linkedin'");
addColumnIfMissing('settings', 'platforms', `TEXT NOT NULL DEFAULT '["linkedin","instagram"]'`);
addColumnIfMissing('settings', 'email_reports', 'INTEGER NOT NULL DEFAULT 0');

// --- Helpers ---------------------------------------------------------------

export function getOrCreateUser({ email = null, linkedinUrl = null } = {}) {
  if (email) {
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existing) return existing;
  }
  const info = db
    .prepare('INSERT INTO users (email, linkedin_url) VALUES (?, ?)')
    .run(email, linkedinUrl);
  ensureSettings(info.lastInsertRowid);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function ensureSettings(userId) {
  const row = db.prepare('SELECT user_id FROM settings WHERE user_id = ?').get(userId);
  if (!row) db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
}

export function getSettings(userId) {
  ensureSettings(userId);
  const s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  let platforms;
  try { platforms = JSON.parse(s.platforms); } catch { platforms = ['linkedin', 'instagram']; }
  if (!Array.isArray(platforms) || !platforms.length) platforms = ['linkedin', 'instagram'];
  return {
    tone: s.tone,
    links: JSON.parse(s.links),
    keywords: JSON.parse(s.keywords),
    industries: JSON.parse(s.industries),
    targetProfiles: JSON.parse(s.target_profiles),
    guideline: s.guideline,
    fillMode: s.fill_mode,
    reviewBefore: !!s.review_before,
    platforms,
    emailReports: !!s.email_reports,
    updatedAt: s.updated_at,
  };
}

export function saveSettings(userId, patch) {
  ensureSettings(userId);
  const cur = getSettings(userId);
  const next = { ...cur, ...patch };
  const VALID_PLATFORMS = ['linkedin', 'instagram'];
  let platforms = Array.isArray(next.platforms)
    ? next.platforms.filter((p) => VALID_PLATFORMS.includes(p))
    : VALID_PLATFORMS;
  if (!platforms.length) platforms = VALID_PLATFORMS;

  db.prepare(
    `UPDATE settings SET
       tone = ?, links = ?, keywords = ?, industries = ?,
       target_profiles = ?, guideline = ?, fill_mode = ?, review_before = ?,
       platforms = ?, email_reports = ?,
       updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(
    next.tone,
    JSON.stringify(next.links ?? []),
    JSON.stringify(next.keywords ?? []),
    JSON.stringify(next.industries ?? []),
    JSON.stringify(next.targetProfiles ?? []),
    next.guideline ?? '',
    ['queue', 'autofill', 'clipboard'].includes(next.fillMode) ? next.fillMode : 'queue',
    next.reviewBefore ? 1 : 0,
    JSON.stringify(platforms),
    next.emailReports ? 1 : 0,
    userId
  );
  return getSettings(userId);
}
