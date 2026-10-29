// Background service worker (MV3). Bridges the content script to the backend,
// so the Claude call happens server-side and the key is never in page context.
// It holds NO scheduler, NO pacing, NO auto-post logic by design.

import { api, getConfig, setStore, getStore } from './shared.js';

async function handleDraft(payload) {
  const cfg = await getConfig();
  if (!cfg.token) {
    return { ok: false, error: 'Not connected. Open the extension options and enter your license key.' };
  }

  // Ask the backend to draft. It also returns the user's fill mode so the
  // content script knows whether to fill the box or copy to clipboard.
  const draftRes = await api('/draft-comment', { method: 'POST', body: payload });
  if (!draftRes.ok) return draftRes;

  const settingsRes = await api('/get-settings');
  const fillMode = settingsRes.ok ? settingsRes.data.fillMode : 'queue';

  return {
    ok: true,
    data: {
      comment: draftRes.data.comment,
      category: draftRes.data.category,
      logId: draftRes.data.id,
      fillMode,
    },
  };
}

async function handleEngagementLog(payload) {
  const cfg = await getConfig();
  if (!cfg.token) {
    return { ok: false, error: 'Not connected. Open the extension options and enter your license key.' };
  }
  return api('/log-engagement', { method: 'POST', body: payload });
}

async function handleUpdateDraft(payload) {
  const cfg = await getConfig();
  if (!cfg.token) {
    return { ok: false, error: 'Not connected. Open the extension options and enter your license key.' };
  }
  return api('/update-draft', { method: 'POST', body: payload });
}

async function handleWarning(payload) {
  // Persist the last warning so the popup can show it and nothing is lost.
  await setStore({ lastWarning: { ...payload, at: Date.now() } });
  // Badge the action icon red.
  try {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
  } catch {
    /* ignore */
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'DRAFT') sendResponse(await handleDraft(msg.payload));
      else if (msg?.type === 'LOG_ENGAGEMENT') {
        sendResponse(await handleEngagementLog(msg.payload));
      }
      else if (msg?.type === 'UPDATE_DRAFT') {
        sendResponse(await handleUpdateDraft(msg.payload));
      }
      else if (msg?.type === 'WARNING') sendResponse(await handleWarning(msg.payload));
      else if (msg?.type === 'CLEAR_WARNING') {
        await setStore({ lastWarning: null });
        try { await chrome.action.setBadgeText({ text: '' }); } catch {}
        sendResponse({ ok: true });
      } else sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || 'Background error' });
    }
  })();
  return true; // keep the channel open for the async response
});
