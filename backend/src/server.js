import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';

import './db.js'; // initialize schema on boot
import { activeProvider } from './llm.js';
import { sendDailyReports, smtpConfigured } from './mailer.js';
import licenseRoutes from './routes/license.js';
import settingsRoutes from './routes/settings.js';
import draftRoutes from './routes/draft.js';
import engagementRoutes from './routes/engagement.js';
import reportRoutes from './routes/reports.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const origins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: origins.includes('*') ? true : origins,
    methods: ['GET', 'POST'],
  })
);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api', licenseRoutes);
app.use('/api', settingsRoutes);
app.use('/api', draftRoutes);
app.use('/api', engagementRoutes);
app.use('/api', reportRoutes);

// Central error handler: never leak a stack to the client, never crash.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'Internal error' });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Engagement Assistant backend listening on http://localhost:${port}`);
  const provider = activeProvider();
  const model = provider === 'gemini'
    ? (process.env.GEMINI_MODEL || 'gemini-flash-latest')
    : (process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001');
  console.log(`LLM provider: ${provider} (model: ${model})`);

  // Daily email report scheduler. Default 6pm server time; override with REPORT_CRON.
  const schedule = process.env.REPORT_CRON || '0 18 * * *';
  if (cron.validate(schedule)) {
    cron.schedule(schedule, () => {
      sendDailyReports().catch((e) => console.error('[cron] report run failed', e));
    });
    console.log(`Daily report cron: ${schedule} ${smtpConfigured() ? '(SMTP ready)' : '(SMTP not configured, will skip)'}`);
  } else {
    console.warn(`Invalid REPORT_CRON "${schedule}"; daily reports disabled.`);
  }
});
