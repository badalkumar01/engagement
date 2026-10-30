/*
 * Content script. Runs in the user's own LinkedIn / Instagram tab.
 *
 * Flow:
 *   - Adds a branded "Draft comment" button to each post.
 *   - On click, reads the post, asks the backend for a draft, and opens an
 *     inline REVIEW PANEL below the post: an editable box with the draft and
 *     buttons to Regenerate, edit, place it in the comment box, copy, mark
 *     posted, or discard.
 *   - "Place in comment box" fills the platform's own composer and focuses it.
 *     You review and click the platform's native Post button yourself.
 *
 * It never submits a comment itself and never acts in the account on its own.
 * Platform specifics live in adapters.js (loaded first). Everything is wrapped
 * so a missing selector logs and skips, never crashes.
 */

(() => {
  'use strict';

  const adapter = self.LEA_ADAPTERS?.resolve();
  if (!adapter) return;

  const BTN_CLASS = 'lea-draft-btn';
  const PANEL_CLASS = 'lea-panel';
  const BRAND = 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)';
  const log = (...a) => console.debug('[LEA]', adapter.platform, ...a);
  const SEL = adapter.sel;
  let enabled = true;

  function pick(root, list) {
    for (const s of list) {
      try { const el = root.querySelector(s); if (el) return el; } catch { /* next */ }
    }
    return null;
  }
  const textOf = (el) => (el?.innerText || el?.textContent || '').trim();

  // --- Warnings ------------------------------------------------------------
  function checkForWarnings() {
    try {
      if (adapter.checkpointPath.test(location.pathname) || adapter.checkpointPath.test(location.href)) {
        return `${adapter.label} checkpoint detected. Stop and resolve it in your tab before continuing.`;
      }
      const bodyText = (document.body?.innerText || '').toLowerCase();
      for (const f of adapter.warningPhrases) {
        if (bodyText.includes(f.toLowerCase())) {
          return `${adapter.label} warning detected ("${f}"). Stop and resolve it before continuing.`;
        }
      }
      if (document.querySelector('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i]')) {
        return 'A captcha is being shown. Stop and complete it manually.';
      }
    } catch { /* ignore */ }
    return null;
  }

  let warned = false;
  function surfaceWarning(msg) {
    if (warned) return;
    warned = true;
    chrome.runtime.sendMessage({ type: 'WARNING', payload: { message: msg, url: location.href, platform: adapter.platform } }).catch(() => {});
    showBanner(msg, true);
    document.querySelectorAll('.' + BTN_CLASS).forEach((b) => b.remove());
  }

  function showBanner(message, isError = false) {
    let bar = document.getElementById('lea-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'lea-banner';
      bar.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;font:600 13px/1.4 system-ui,sans-serif;text-align:center;';
      document.documentElement.appendChild(bar);
    }
    bar.style.background = isError ? '#b91c1c' : '#4f46e5';
    bar.style.color = '#fff';
    bar.textContent = message;
    if (!isError) setTimeout(() => { bar.remove(); }, 4000);
  }

  // --- Reading / filling ---------------------------------------------------
  // Generic fallback: the post's real caption is almost always the longest
  // user-text block (LinkedIn/Instagram wrap it in dir="ltr"/"auto"), which is
  // robust to class-name changes.
  function bestTextBlock(postEl) {
    let best = '';
    let nodes = [];
    try { nodes = postEl.querySelectorAll('span[dir="ltr"], span[dir="auto"], div[dir="ltr"], div[dir="auto"], p'); } catch { /* ignore */ }
    nodes.forEach((el) => {
      // skip nodes that merely contain other candidate blocks (avoid duplication)
      if (el.querySelector('span[dir], p')) return;
      const t = textOf(el);
      if (t.length > best.length) best = t;
    });
    return best;
  }

  function readPost(postEl) {
    const author = textOf(pick(postEl, SEL.author)) || 'unknown';
    let text = textOf(pick(postEl, SEL.text));
    if (!text || text.length < 10) text = bestTextBlock(postEl);
    let url = location.href;
    try { url = adapter.postUrl(postEl) || url; } catch { /* ignore */ }
    return { author, text: text || '', url };
  }

  function openCommentBox(postEl) {
    const btn = pick(postEl, SEL.commentButton);
    if (!btn) return;
    const clickable = btn.closest('button, [role="button"], a') || btn;
    if (clickable.getAttribute('aria-expanded') !== 'true') clickable.click();
  }

  function setEditorValue(editor, draft) {
    if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
      const proto = Object.getPrototypeOf(editor);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) desc.set.call(editor, draft); else editor.value = draft;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      editor.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = draft;
      editor.appendChild(p);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    }
  }

  function fillEditor(postEl, draft) {
    return new Promise((resolve) => {
      let tries = 0;
      const tick = () => {
        const editor = pick(postEl, SEL.editor) || pick(document, SEL.editor);
        if (editor) {
          try {
            editor.focus();
            setEditorValue(editor, draft);
            editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
            resolve(true);
          } catch (e) { log('fillEditor error', e); resolve(false); }
          return;
        }
        if (tries++ < 20) setTimeout(tick, 150); else resolve(false);
      };
      tick();
    });
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  // --- Small styled button helper -----------------------------------------
  function mkBtn(label, kind) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const base = 'border-radius:9px;padding:8px 13px;font:600 13px system-ui,sans-serif;cursor:pointer;border:1px solid transparent;transition:filter .12s;';
    if (kind === 'primary') b.style.cssText = base + `background:${BRAND};color:#fff;`;
    else if (kind === 'danger') b.style.cssText = base + 'background:transparent;color:#dc2626;border-color:#f0c2c2;';
    else b.style.cssText = base + 'background:#ffffff;color:#4f46e5;border-color:#d7d9f2;';
    b.onmouseenter = () => { b.style.filter = 'brightness(1.05)'; };
    b.onmouseleave = () => { b.style.filter = 'none'; };
    return b;
  }

  // --- Inline review panel -------------------------------------------------
  function removePanel(postEl) {
    postEl.querySelector('.' + PANEL_CLASS)?.remove();
  }

  function renderPanel(postEl, post, data) {
    removePanel(postEl);
    let logId = data.logId;
    const original = data.comment;

    const panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    panel.style.cssText =
      'max-width:620px;margin:10px 8px;padding:14px;border:1px solid #e3e8ee;border-radius:14px;background:#ffffff;color:#1d2226;box-shadow:0 2px 6px rgba(16,24,40,.08),0 16px 40px rgba(16,24,40,.12);font:14px/1.5 system-ui,sans-serif;';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
    head.innerHTML =
      '<span style="width:24px;height:24px;border-radius:7px;background:' + BRAND + ';display:inline-grid;place-items:center;">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/></svg></span>' +
      '<b style="font-size:14px;">Draft comment</b>' +
      '<span style="color:#667080;font-size:12px;">review, edit, then post it yourself</span>';

    const ta = document.createElement('textarea');
    ta.value = original;
    ta.setAttribute('aria-label', 'Edit draft comment');
    ta.style.cssText =
      'width:100%;box-sizing:border-box;min-height:74px;resize:vertical;padding:10px 12px;border:1px solid #d7dde4;border-radius:9px;font:14px/1.5 system-ui,sans-serif;color:#1d2226;background:#fff;';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:12.5px;color:#667080;margin-top:8px;min-height:16px;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;';

    const bRegen = mkBtn('Regenerate', 'ghost');
    const bPlace = mkBtn('Place in comment box', 'primary');
    const bCopy = mkBtn('Copy', 'ghost');
    const bPosted = mkBtn('Mark posted', 'ghost');
    bPosted.style.color = '#15803d'; bPosted.style.borderColor = '#bfe3c8';
    const bDiscard = mkBtn('Discard', 'danger');

    async function persistEditIfChanged() {
      const val = ta.value.trim();
      if (val && val !== original && logId) {
        try { await chrome.runtime.sendMessage({ type: 'UPDATE_DRAFT', payload: { id: logId, comment: val } }); } catch { /* ignore */ }
      }
      return val;
    }

    bRegen.addEventListener('click', async () => {
      bRegen.disabled = true; status.textContent = 'Regenerating...';
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'DRAFT',
          payload: {
            postText: post.text, postAuthor: post.author, postUrl: post.url,
            surface: adapter.detectSurface(), platform: adapter.platform,
            postType: data.media?.type, images: data.media?.images || [],
          },
        });
        if (resp?.ok) { ta.value = resp.data.comment; logId = resp.data.logId; status.textContent = 'New draft ready.'; }
        else status.textContent = resp?.error || 'Could not regenerate.';
      } catch { status.textContent = 'Could not regenerate.'; }
      finally { bRegen.disabled = false; }
    });

    bPlace.addEventListener('click', async () => {
      const val = await persistEditIfChanged();
      if (!val) { status.textContent = 'Nothing to place.'; return; }
      openCommentBox(postEl);
      const ok = await fillEditor(postEl, val);
      status.textContent = ok
        ? 'Placed in the comment box below. Review it, then click ' + adapter.label + '’s Post button.'
        : 'Could not find the comment box. Use Copy instead.';
    });

    bCopy.addEventListener('click', async () => {
      const ok = await copyToClipboard(ta.value.trim());
      status.textContent = ok ? 'Copied. Paste it into the comment box and post.' : 'Clipboard was blocked.';
    });

    bPosted.addEventListener('click', async () => {
      await persistEditIfChanged();
      bPosted.disabled = true; status.textContent = 'Saving...';
      try {
        const r = await chrome.runtime.sendMessage({ type: 'LOG_ENGAGEMENT', payload: { id: logId, status: 'posted' } });
        if (r?.ok) { status.textContent = 'Logged as posted.'; setTimeout(() => removePanel(postEl), 1200); }
        else { bPosted.disabled = false; status.textContent = r?.error || 'Could not log.'; }
      } catch { bPosted.disabled = false; status.textContent = 'Could not log.'; }
    });

    bDiscard.addEventListener('click', async () => {
      try { if (logId) await chrome.runtime.sendMessage({ type: 'LOG_ENGAGEMENT', payload: { id: logId, status: 'skipped' } }); } catch { /* ignore */ }
      removePanel(postEl);
    });

    actions.append(bPlace, bRegen, bCopy, bPosted, bDiscard);
    panel.append(head, ta, status, actions);
    (pick(postEl, SEL.actionBar) || postEl).insertAdjacentElement('afterend', panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // --- Draft flow ----------------------------------------------------------
  // Turns the button into an animated progress bar while drafting. The percent
  // is a smooth estimate (the backend gives no real progress), with a status line.
  function startProgress(btn) {
    const original = btn.innerHTML;
    const origCss = btn.style.cssText;
    btn.disabled = true;
    btn.style.cssText = origCss + 'min-width:210px;';
    let pct = 0;
    const stages = [[0, 'Reading the post'], [25, 'Drafting with AI'], [70, 'Polishing the comment']];
    const statusText = () => { let s = stages[0][1]; for (const [t, l] of stages) if (pct >= t) s = l; return s; };
    const render = () => {
      btn.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:190px;">' +
        '<div style="height:6px;background:rgba(255,255,255,.3);border-radius:4px;overflow:hidden;">' +
        '<div style="height:100%;width:' + pct + '%;background:#fff;transition:width .2s ease;"></div></div>' +
        '<span style="font:600 11px system-ui,sans-serif;color:#fff;">' + pct + '% · ' + statusText() + '</span></div>';
    };
    render();
    const iv = setInterval(() => { if (pct < 92) { pct += Math.max(1, Math.round((92 - pct) * 0.08)); render(); } }, 120);
    return {
      finish() { clearInterval(iv); pct = 100; render(); },
      restore() { clearInterval(iv); btn.disabled = false; btn.style.cssText = origCss; btn.innerHTML = original; },
    };
  }

  // Step through a carousel (bounded) collecting each slide's image URL, so the
  // draft reflects the whole carousel, not just the first slide.
  async function collectCarousel(postEl, initial) {
    const urls = new Set(initial || []);
    for (let i = 0; i < 6 && urls.size < 8; i++) {
      const next = postEl.querySelector('button[aria-label="Next"], [aria-label="Next"][role="button"]');
      if (!next) break;
      try { next.click(); } catch { break; }
      await new Promise((r) => setTimeout(r, 450));
      try { (adapter.media(postEl).images || []).forEach((u) => urls.add(u)); } catch { /* ignore */ }
    }
    return [...urls].slice(0, 8);
  }

  async function handleDraft(postEl, btn) {
    const w = checkForWarnings();
    if (w) return surfaceWarning(w);

    const prog = startProgress(btn);
    try {
      const post = readPost(postEl);

      // Understand the post's media (image / carousel / video cover frame).
      let media = { type: 'text', images: [] };
      try { if (adapter.media) media = adapter.media(postEl); } catch { /* ignore */ }
      if (media.type === 'carousel') {
        try { media.images = await collectCarousel(postEl, media.images); } catch { /* ignore */ }
      }

      const hasText = post.text && post.text.length >= 10;
      if (!hasText && (!media.images || !media.images.length)) {
        prog.restore();
        showBanner('Could not read this post, skipping.', true);
        return;
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'DRAFT',
        payload: {
          postText: post.text,
          postAuthor: post.author,
          postUrl: post.url,
          surface: adapter.detectSurface(),
          platform: adapter.platform,
          postType: media.type,
          images: media.images,
        },
      });
      if (!resp || !resp.ok) { prog.restore(); showBanner(resp?.error || 'Drafting failed.', true); return; }

      prog.finish();
      setTimeout(() => { renderPanel(postEl, post, { comment: resp.data.comment, logId: resp.data.logId, media }); prog.restore(); }, 280);
    } catch (e) {
      log('handleDraft error', e);
      prog.restore();
      showBanner('Something went wrong drafting this comment.', true);
    }
  }

  // --- Branded button ------------------------------------------------------
  function makeButton() {
    const b = document.createElement('button');
    b.className = BTN_CLASS;
    b.type = 'button';
    b.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" style="vertical-align:-2px;margin-right:6px;"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2zm7 12l.9 3.1L23 18l-3.1.9L19 22l-.9-3.1L15 18l3.1-.9L19 14z"/></svg>Draft comment';
    b.style.cssText =
      `margin:4px 8px;padding:8px 15px;border:none;border-radius:18px;background:${BRAND};color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(79,70,229,.35);`;
    return b;
  }

  function injectInto(postEl) {
    try {
      if (postEl.querySelector('.' + BTN_CLASS)) return;
      const btn = makeButton();
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handleDraft(postEl, btn); });

      // Prefer the social action bar; fall back to next to the comment button;
      // last resort, pin it to the top of the post so it is always visible.
      const bar = pick(postEl, SEL.actionBar);
      if (bar) { bar.appendChild(btn); return; }
      const cb = pick(postEl, SEL.commentButton);
      if (cb && cb.parentElement) { cb.parentElement.insertBefore(btn, cb.nextSibling); return; }
      postEl.insertBefore(btn, postEl.firstChild);
    } catch (e) { log('injectInto skipped', e); }
  }

  // Find the post container that owns a given element (e.g. a comment button).
  function findPostContainer(el) {
    for (const sel of SEL.post) {
      try { const c = el.closest(sel); if (c) return c; } catch { /* bad selector */ }
    }
    try { const a = el.closest('article, div[role="article"], [data-urn], [data-id]'); if (a) return a; } catch { /* ignore */ }
    // last resort: climb a few levels to a reasonably sized block
    let n = el;
    for (let i = 0; i < 6 && n.parentElement; i++) n = n.parentElement;
    return n;
  }

  function scanPosts() {
    if (!enabled) return;
    const w = checkForWarnings();
    if (w) return surfaceWarning(w);

    // Primary: match post containers by class/urn.
    for (const sel of SEL.post) {
      let nodes = [];
      try { nodes = document.querySelectorAll(sel); } catch { continue; }
      if (nodes.length) { nodes.forEach(injectInto); break; }
    }

    // Robust fallback: anchor on each Comment button (its aria-label is stable
    // even when post classes change) and add our button beside it.
    let anchors = [];
    for (const sel of SEL.commentButton) {
      try { const n = document.querySelectorAll(sel); if (n.length) { anchors = Array.from(n); break; } } catch { /* ignore */ }
    }
    for (const a of anchors) {
      const postEl = findPostContainer(a);
      if (!postEl || postEl.querySelector('.' + BTN_CLASS)) continue;
      try {
        const btn = makeButton();
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handleDraft(postEl, btn); });
        const clickable = a.closest('button, [role="button"], a') || a;
        (clickable.parentElement || postEl).insertBefore(btn, clickable.nextSibling);
      } catch (e) { log('anchor inject skipped', e); }
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(scanPosts, 300);
  });

  function begin() {
    try {
      scanPosts();
      observer.observe(document.body, { childList: true, subtree: true });
      setInterval(() => { const w = checkForWarnings(); if (w) surfaceWarning(w); }, 5000);
      log('content script ready');
    } catch (e) { log('start failed', e); }
  }

  function start() {
    try {
      chrome.storage.local.get(['enabledPlatforms'], (res) => {
        const list = res?.enabledPlatforms;
        if (Array.isArray(list) && !list.includes(adapter.platform)) { enabled = false; log('platform disabled'); return; }
        begin();
      });
    } catch { begin(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
