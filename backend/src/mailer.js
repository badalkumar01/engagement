// Daily email report. Builds a summary of the user's posted comments and sends
// it over SMTP (configured in .env). If SMTP is not configured, sending is a
// no-op that reports why, so the server never crashes over mail.

import nodemailer from 'nodemailer';
import { db } from './db.js';

const SURFACE_LABEL = { home: 'Home feed', search: 'Keyword search', profile: 'Profiles', own_post: 'Your posts', explore: 'Explore', post: 'Posts' };
const CATEGORY_LABEL = { question: 'Question', appreciation: 'Appreciation', relatable: 'Relatable', value_add: 'Value-add' };
const PLATFORM_LABEL = { linkedin: 'LinkedIn', instagram: 'Instagram' };

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

let transport = null;
function getTransport() {
  if (!smtpConfigured()) return null;
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

// Build a report object for one user over [since, now].
export function buildReport(userId, since) {
  const sinceSql = since.replace('T', ' ').slice(0, 19);
  const rows = db
    .prepare(
      `SELECT post_url, surface, category, platform, comment, created_at
         FROM engagement_log
        WHERE user_id = ? AND created_at >= ? AND status = 'posted'
        ORDER BY id DESC`
    )
    .all(userId, sinceSql);

  const tally = (key) => {
    const out = {};
    for (const r of rows) if (r[key]) out[r[key]] = (out[r[key]] || 0) + 1;
    return out;
  };
  return {
    total: rows.length,
    byPlatform: tally('platform'),
    bySurface: tally('surface'),
    byCategory: tally('category'),
    posts: rows,
  };
}

function renderText(report, dateLabel) {
  const line = (obj, labels) =>
    Object.entries(obj).map(([k, v]) => `  ${labels[k] || k}: ${v}`).join('\n') || '  (none)';
  const posts = report.posts
    .map((p) => `  - [${PLATFORM_LABEL[p.platform] || p.platform}] ${CATEGORY_LABEL[p.category] || p.category || 'comment'}${p.post_url ? ' ' + p.post_url : ''}`)
    .join('\n') || '  (none)';
  return `Your engagement report for ${dateLabel}

Total comments posted: ${report.total}

By platform:
${line(report.byPlatform, PLATFORM_LABEL)}

By surface:
${line(report.bySurface, SURFACE_LABEL)}

By category:
${line(report.byCategory, CATEGORY_LABEL)}

Posts you commented on:
${posts}

Reminder: you posted each of these yourself after reviewing the draft.`;
}

function renderHtml(report, dateLabel) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = (obj, labels) =>
    Object.entries(obj).map(([k, v]) => `<tr><td>${esc(labels[k] || k)}</td><td style="text-align:right">${v}</td></tr>`).join('') ||
    '<tr><td colspan="2">(none)</td></tr>';
  const posts = report.posts
    .map((p) => {
      const label = `${PLATFORM_LABEL[p.platform] || p.platform} · ${CATEGORY_LABEL[p.category] || p.category || 'comment'}`;
      return `<li>${p.post_url ? `<a href="${esc(p.post_url)}">${esc(label)}</a>` : esc(label)}</li>`;
    })
    .join('') || '<li>(none)</li>';
  return `<div style="font:14px/1.5 system-ui,sans-serif;color:#1d2226;max-width:560px">
    <h2 style="margin:0 0 4px">Engagement report</h2>
    <p style="color:#6b7280;margin:0 0 16px">${esc(dateLabel)}</p>
    <p style="font-size:28px;font-weight:700;margin:0">${report.total}</p>
    <p style="color:#6b7280;margin:0 0 16px">comments posted</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:12px"><tbody>
      <tr><th colspan="2" style="text-align:left;border-bottom:1px solid #d7dde2">By platform</th></tr>${rows(report.byPlatform, PLATFORM_LABEL)}
      <tr><th colspan="2" style="text-align:left;border-bottom:1px solid #d7dde2;padding-top:8px">By category</th></tr>${rows(report.byCategory, CATEGORY_LABEL)}
    </tbody></table>
    <h3 style="margin:0 0 6px">Posts you commented on</h3>
    <ul style="margin:0;padding-left:18px">${posts}</ul>
    <p style="color:#9aa6b1;font-size:12px;margin-top:16px">You posted each of these yourself after reviewing the draft.</p>
  </div>`;
}

// Send a report to one user. Returns { sent, reason }.
export async function sendReport(user, { since } = {}) {
  if (!user?.email) return { sent: false, reason: 'User has no email on file' };
  const t = getTransport();
  if (!t) return { sent: false, reason: 'SMTP is not configured on the server' };

  const sinceIso = since || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const report = buildReport(user.id, sinceIso);
  const dateLabel = new Date(sinceIso).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  await t.sendMail({
    from: process.env.MAIL_FROM,
    to: user.email,
    subject: `Your engagement report (${report.total} posted)`,
    text: renderText(report, dateLabel),
    html: renderHtml(report, dateLabel),
  });
  return { sent: true, to: user.email, total: report.total };
}

// Send to every user who opted in. Used by the daily scheduler.
export async function sendDailyReports() {
  if (!smtpConfigured()) {
    console.log('[mailer] daily report skipped: SMTP not configured');
    return { attempted: 0 };
  }
  const users = db
    .prepare(
      `SELECT u.id, u.email FROM users u
         JOIN settings s ON s.user_id = u.id
        WHERE s.email_reports = 1 AND u.email IS NOT NULL AND u.email <> ''`
    )
    .all();
  let ok = 0;
  for (const user of users) {
    try {
      const r = await sendReport(user);
      if (r.sent) ok++;
    } catch (e) {
      console.error('[mailer] failed for user', user.id, e?.message);
    }
  }
  console.log(`[mailer] daily reports sent: ${ok}/${users.length}`);
  return { attempted: users.length, sent: ok };
}
