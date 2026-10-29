/*
 * Platform adapters. Loaded before content.js in the same isolated world, so it
 * exposes a plain global (self.LEA_ADAPTERS). Each adapter describes how to read
 * posts and find the comment box on one site. The shared content.js does the
 * rest (button injection, draft request, warning surfacing, fill).
 *
 * Selectors are best-effort with fallbacks. LinkedIn's are stable-ish; Instagram
 * is a heavily obfuscated React app, so its selectors are more fragile and are
 * the first thing to update if the button stops appearing. A missing selector
 * logs and skips, never crashes.
 */

(() => {
  'use strict';

  const linkedin = {
    platform: 'linkedin',
    label: 'LinkedIn',
    accent: '#0a66c2',
    matches: (h) => h.endsWith('linkedin.com'),
    sel: {
      post: [
        'div.feed-shared-update-v2',
        'div.update-components-actor + div',
        '[data-urn^="urn:li:activity"]',
      ],
      author: [
        '.update-components-actor__title span[aria-hidden="true"]',
        '.update-components-actor__name',
        '.feed-shared-actor__name',
        'span.actor-name',
      ],
      text: [
        '.update-components-text',
        '.feed-shared-update-v2__description',
        '.feed-shared-text',
      ],
      commentButton: [
        'button[aria-label*="Comment" i]',
        'button.comment-button',
      ],
      editor: [
        'div.ql-editor[contenteditable="true"]',
        'div.comments-comment-box__editor [contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
      ],
      actionBar: [
        '.feed-shared-social-action-bar',
        '.social-actions-buttons',
        '.feed-shared-social-actions',
      ],
    },
    detectSurface() {
      const p = location.pathname;
      if (p.startsWith('/search/')) return 'search';
      if (p.startsWith('/in/')) return 'profile';
      return 'home';
    },
    postUrl(postEl) {
      const urn = postEl.getAttribute('data-urn');
      if (urn) return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;
      return location.href;
    },
    checkpointPath: /\/checkpoint\//i,
    warningPhrases: [
      'unusual activity', 'verify it’s you', "verify it's you",
      'confirm your identity', 'temporarily restricted', 'security verification',
    ],
  };

  const instagram = {
    platform: 'instagram',
    label: 'Instagram',
    accent: '#c13584',
    matches: (h) => h.endsWith('instagram.com'),
    sel: {
      post: ['article[role="presentation"]', 'article'],
      author: ['header a[role="link"]', 'header a', 'a[role="link"] span'],
      // Caption lives in an h1 on a post page, or a dir="auto" span in the feed.
      text: ['h1', 'article h1', 'ul li span[dir="auto"]', 'span[dir="auto"]'],
      commentButton: ['svg[aria-label="Comment"]', '[aria-label="Comment"]'],
      // Instagram uses a <textarea>, not a contenteditable div.
      editor: ['textarea[aria-label^="Add a comment"]', 'textarea[placeholder^="Add a comment"]', 'form textarea'],
      actionBar: ['section', 'article section'],
    },
    detectSurface() {
      const p = location.pathname;
      if (p.startsWith('/explore/')) return 'explore';
      if (p.startsWith('/p/') || p.startsWith('/reel/')) return 'post';
      if (p === '/' || p === '') return 'home';
      return 'profile';
    },
    postUrl(postEl) {
      // Prefer a permalink anchor inside the post (/p/<id>/ or /reel/<id>/).
      try {
        const a = postEl.querySelector('a[href*="/p/"], a[href*="/reel/"]');
        if (a?.href) return a.href;
      } catch { /* ignore */ }
      return location.href;
    },
    checkpointPath: /\/(challenge|accounts\/suspended)\//i,
    warningPhrases: [
      'try again later', 'we restrict certain activity', 'suspicious login',
      'confirm it’s you', "confirm it's you", 'your account has been temporarily',
      'action blocked',
    ],
  };

  const ADAPTERS = [linkedin, instagram];

  self.LEA_ADAPTERS = {
    all: ADAPTERS,
    resolve(hostname = location.hostname) {
      return ADAPTERS.find((a) => a.matches(hostname)) || null;
    },
  };
})();
