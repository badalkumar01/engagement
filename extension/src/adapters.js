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

  // --- Shared media extraction -------------------------------------------
  function pickImgSrc(im) {
    try {
      if (im.srcset) {
        const parts = im.srcset.split(',').map((s) => s.trim().split(/\s+/));
        const last = parts[parts.length - 1];
        if (last && last[0]) return last[0];
      }
    } catch { /* ignore */ }
    return im.currentSrc || im.src || '';
  }
  // Grab the current video frame as a JPEG data URL. Works when the video is a
  // blob/same-origin source (common on IG/LinkedIn); returns null if the canvas
  // is cross-origin tainted. This is how we read on-screen text in Reels/videos.
  function captureVideoFrame(video) {
    try {
      if (!video || !video.videoWidth) return null;
      const scale = Math.min(1, 720 / video.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(video.videoWidth * scale);
      c.height = Math.round(video.videoHeight * scale);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.7); // throws if tainted
      return url && url.length > 100 ? url : null;
    } catch { return null; }
  }

  // Returns { type: 'text'|'static'|'carousel'|'video', images: [url] }.
  function extractMedia(postEl, { hostRe, excludeSel }) {
    const out = { type: 'text', images: [] };
    try {
      const video = postEl.querySelector('video');
      const imgs = Array.from(postEl.querySelectorAll('img')).filter((im) => {
        if (excludeSel && im.closest(excludeSel)) return false; // skip avatars/header
        const big = (im.naturalWidth || im.width || 0) >= 200;
        const host = hostRe ? hostRe.test(im.currentSrc || im.src || '') : false;
        return big || host;
      });
      let urls = imgs.map(pickImgSrc).filter((u) => /^https?:\/\//.test(u));
      const isCarousel = !!postEl.querySelector('button[aria-label="Next"], [aria-label="Next"][role="button"]') || urls.length > 1;
      if (video) {
        out.type = 'video';
        const frame = captureVideoFrame(video); // reads on-screen text when possible
        if (frame) urls.unshift(frame);
        const poster = video.getAttribute('poster');
        if (poster && /^https?:\/\//.test(poster)) urls.push(poster);
      } else if (isCarousel) {
        out.type = 'carousel';
      } else if (urls.length) {
        out.type = 'static';
      }
      out.images = [...new Set(urls)].slice(0, 6);
    } catch { /* ignore */ }
    return out;
  }

  const linkedin = {
    platform: 'linkedin',
    label: 'LinkedIn',
    accent: '#0a66c2',
    matches: (h) => h.endsWith('linkedin.com'),
    sel: {
      post: [
        'div.feed-shared-update-v2',
        'div.fie-impression-container',
        'div[data-urn^="urn:li:activity"]',
        '[data-urn^="urn:li:activity"]',
        'div.update-components-actor + div',
        'main [data-id^="urn:li:activity"]',
      ],
      author: [
        '.update-components-actor__title span[aria-hidden="true"]',
        '.update-components-actor__title',
        '.update-components-actor__name',
        '.feed-shared-actor__name',
        'span.actor-name',
      ],
      text: [
        '.update-components-text',
        '.feed-shared-update-v2__description',
        '.feed-shared-text',
        '.break-words',
      ],
      commentButton: [
        'button[aria-label*="Comment" i]',
        'button[aria-label*="comment" i]',
        '[role="button"][aria-label*="comment" i]',
        'button.comment-button',
      ],
      editor: [
        'div.ql-editor[contenteditable="true"]',
        'div.comments-comment-box__editor [contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
      ],
      actionBar: [
        '.feed-shared-social-action-bar',
        '.feed-shared-social-actions',
        '.social-actions-buttons',
        '.update-v2-social-activity',
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
    media(postEl) {
      return extractMedia(postEl, { hostRe: /licdn\.com|media\./, excludeSel: '.update-components-actor, header' });
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
    media(postEl) {
      return extractMedia(postEl, { hostRe: /scontent|cdninstagram/, excludeSel: 'header' });
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
