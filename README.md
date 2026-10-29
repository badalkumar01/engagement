# LinkedIn Engagement Assistant

A Chrome extension (Manifest V3) plus a small Node backend that drafts thoughtful,
post-specific LinkedIn comments with Claude. Drafts go to the review queue by
default, and you choose whether to copy, edit, or move them into LinkedIn's
composer.

## What it does

- Adds a **"Draft with Claude"** button to each LinkedIn post in your own tab.
- Reads that post's text and author, sends them to your backend, and Claude drafts
  a comment in your tone and category (question, appreciation, relatable, value-add),
  weighted toward genuine questions.
- Keeps drafts in the review queue by default; optional modes fill LinkedIn's
  comment box or copy to clipboard.
- Lets you explicitly mark a draft posted after you submit it yourself, or discard
  it. The popup summary only counts comments you marked as posted.
- Enforces your style rules: specific to the post, never "Great post", no em dashes,
  no hashtags, no pasted links, and **rejects near-duplicates** of your recent comments.
- Logs what you post and shows an end-of-session summary in the popup (totals by
  surface and category, plus the list of posts).
- Detects LinkedIn checkpoints / captchas / warnings and surfaces them loudly.
- Keeps drafts in a review queue by default. You can optionally fill the LinkedIn
  composer instead; you still review and submit each comment yourself.

## What it does NOT do (by design)

- **It never posts for you.** Every comment is placed in the box for you to read,
  edit, and submit with LinkedIn's own Post button.
- No automated scrolling, hovering, dwelling, timed pacing, warm-up ramp, or
  simulated human typing. There is no scheduler and nothing runs in your account
  on its own. The tool helps you write; you stay the one acting.

> This is intentionally a writing aid, not an account automation bot. You review
> and post everything yourself.

## Project layout

```
backend/     Node + Express + SQLite. Holds the Claude API key. Drafts, settings, logging, auth.
extension/   Chrome MV3 extension: content script, background worker, popup, options page.
```

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env     # then edit .env
npm start
```

Edit `.env` and set at least:

- `LLM_PROVIDER` — `gemini` or `claude`. Picks which model drafts comments.
- If `gemini`: `GEMINI_API_KEY` (from Google AI Studio, starts with `AIza`) and
  `GEMINI_MODEL` (default `gemini-flash-latest`, a stable alias that tracks the
  current fast model).
- If `claude`: `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`.
- `JWT_SECRET` — a long random string.

Keys stay on the server and are never shipped in the extension. The drafting
layer retries transient rate-limit/overload (429/503) responses with backoff and
sanitizes output (no em dashes, no hashtags, no markdown, no "Great post" openers).

The server listens on `http://localhost:8787` by default and creates its SQLite
database under `backend/data/`.

### 2. Extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Open the extension's **Settings & onboarding** page (popup → Settings) and:
   - Enter the backend URL (`http://localhost:8787`) and a **license key** (any string
     you choose for self-hosting; it is provisioned on first use), then **Connect**.
   - Confirm your profile, add your links (context only), set keywords/industries/
     target profiles, pick a tone and a drafting guideline preset, choose how drafts
     are delivered, and **Save**.
4. Go to LinkedIn, find a post, and click **Draft with Claude**. Review it in the
   extension's queue (or your selected delivery mode), then submit it yourself.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/license-check` | Validate a license key, return a JWT. |
| `GET  /api/get-settings` | Read your settings. |
| `POST /api/save-settings` | Save tone, links, keywords, industries, targets, guideline, delivery mode. |
| `POST /api/draft-comment` | Draft one comment for a given post (dedup-checked). |
| `POST /api/log-engagement` | Mark a draft posted/skipped, or log a standalone comment. |
| `GET  /api/review-queue` | List drafts still awaiting the user's decision. |
| `POST /api/update-draft` | Save an edited draft, with duplicate checking. |
| `GET  /api/session-summary` | Today's posted totals by surface/category + list. |

## Notes

- If a LinkedIn selector changes, the content script logs and skips gracefully
  rather than crashing; update the fallback selectors in `extension/src/content.js`.
- The daily email report from the original spec is not wired up; `session-summary`
  provides the same breakdown and is the natural data source if you add one.
