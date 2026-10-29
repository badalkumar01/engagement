import { api, getConfig, setStore, getStore, DEFAULTS } from '../src/shared.js';

const $ = (id) => document.getElementById(id);

const PRESETS = [
  {
    id: 'curious-peer',
    title: 'Curious peer',
    text: 'You are a curious peer in the same field. React to one specific point the author made, then ask one genuine open-ended question that moves the conversation forward. Sound human and a little informal.',
  },
  {
    id: 'thoughtful-expert',
    title: 'Thoughtful expert',
    text: 'You are an experienced practitioner. Add one concrete insight or example that extends the author\'s point, without lecturing. Be precise and generous.',
  },
  {
    id: 'warm-supporter',
    title: 'Warm supporter',
    text: 'You are a warm, encouraging connection. Appreciate one specific thing in the post and add a light forward-looking line. Keep it short and sincere.',
  },
  {
    id: 'sharp-operator',
    title: 'Sharp operator',
    text: 'You are a busy operator who values signal. Give a crisp, specific reaction and, where natural, one pointed question. One or two lines, no fluff.',
  },
];

function csv(v) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function lines(v) {
  return (v || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
function msg(el, text, ok = true) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  if (text) setTimeout(() => { el.textContent = ''; }, 4000);
}

function renderPresets(active) {
  $('presets').innerHTML = PRESETS.map(
    (p) => `<div class="preset${p.id === active ? ' active' : ''}" data-id="${p.id}"><b>${p.title}</b><span class="hint">${p.text.slice(0, 90)}...</span></div>`
  ).join('');
  document.querySelectorAll('.preset').forEach((el) => {
    el.addEventListener('click', () => {
      const p = PRESETS.find((x) => x.id === el.dataset.id);
      if (!p) return;
      $('guideline').value = p.text;
      renderPresets(p.id);
    });
  });
}

function getTone() {
  return document.querySelector('input[name=tone]:checked')?.value || 'friendly';
}
function getFillMode() {
  return document.querySelector('input[name=fillMode]:checked')?.value || 'queue';
}
function getPlatforms() {
  const list = [];
  if ($('platLinkedin').checked) list.push('linkedin');
  if ($('platInstagram').checked) list.push('instagram');
  return list.length ? list : ['linkedin', 'instagram'];
}
// The content script reads this to decide whether to show its button on a site.
async function syncEnabledPlatforms(platforms) {
  try { await setStore({ enabledPlatforms: platforms }); } catch { /* storage may be unavailable */ }
}

async function loadLocal() {
  const cfg = await getConfig();
  $('apiBase').value = cfg.apiBase || DEFAULTS.apiBase;
  $('license').value = cfg.license || '';
  const { email } = await getStore(['email']);
  if (email) $('email').value = email;
}

async function connect() {
  const apiBase = $('apiBase').value.trim() || DEFAULTS.apiBase;
  const license = $('license').value.trim();
  const email = $('email').value.trim() || null;
  const linkedinUrl = $('linkedinUrl').value.trim() || null;
  if (!license) return msg($('connMsg'), 'Enter a license key first.', false);

  await setStore({ apiBase, license, email });
  const res = await api('/license-check', {
    method: 'POST',
    auth: false,
    body: { key: license, email, linkedinUrl },
  });
  if (!res.ok) return msg($('connMsg'), res.error || 'Connection failed.', false);

  await setStore({ token: res.data.token, profile: res.data.user });
  msg($('connMsg'), 'Connected.');
  await loadFromServer();
}

async function loadFromServer() {
  const res = await api('/get-settings');
  if (!res.ok) return msg($('saveMsg'), res.error || 'Could not load settings.', false);
  const s = res.data;

  document.querySelector(`input[name=tone][value="${s.tone}"]`)?.setAttribute('checked', 'checked');
  const toneEl = document.querySelector(`input[name=tone][value="${s.tone}"]`);
  if (toneEl) toneEl.checked = true;
  const fillEl = document.querySelector(`input[name=fillMode][value="${s.fillMode}"]`);
  if (fillEl) fillEl.checked = true;

  $('keywords').value = (s.keywords || []).join(', ');
  $('industries').value = (s.industries || []).join(', ');
  $('targetProfiles').value = (s.targetProfiles || []).join('\n');
  $('guideline').value = s.guideline || '';

  const byLabel = Object.fromEntries((s.links || []).map((l) => [l.label, l.url]));
  $('linkWebsite').value = byLabel.website || '';
  $('linkBooking').value = byLabel.booking || '';
  $('linkLead').value = byLabel.lead_magnet || '';

  const { profile } = await getConfig();
  if (profile?.linkedinUrl) $('linkedinUrl').value = profile.linkedinUrl;

  const platforms = s.platforms || ['linkedin', 'instagram'];
  $('platLinkedin').checked = platforms.includes('linkedin');
  $('platInstagram').checked = platforms.includes('instagram');
  await syncEnabledPlatforms(platforms);
  $('emailReports').checked = !!s.emailReports;

  const matched = PRESETS.find((p) => p.text === s.guideline);
  renderPresets(matched?.id);
  await loadQueue();
}

async function save() {
  const { token } = await getConfig();
  if (!token) return msg($('saveMsg'), 'Connect first (step 1).', false);

  const links = [
    { label: 'website', url: $('linkWebsite').value.trim() },
    { label: 'booking', url: $('linkBooking').value.trim() },
    { label: 'lead_magnet', url: $('linkLead').value.trim() },
  ].filter((l) => l.url);

  const platforms = getPlatforms();
  const body = {
    linkedinUrl: $('linkedinUrl').value.trim(),
    tone: getTone(),
    fillMode: getFillMode(),
    links,
    keywords: csv($('keywords').value),
    industries: csv($('industries').value),
    targetProfiles: lines($('targetProfiles').value),
    guideline: $('guideline').value.trim(),
    platforms,
    emailReports: $('emailReports').checked,
  };

  const res = await api('/save-settings', { method: 'POST', body });
  if (!res.ok) return msg($('saveMsg'), res.error || 'Save failed.', false);
  await syncEnabledPlatforms(platforms);
  msg($('saveMsg'), 'Saved.');
}

async function sendReportNow(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const res = await api('/send-report-now', { method: 'POST', body: {} });
  button.disabled = false;
  if (!res.ok) return msg($('reportMsg'), res.error || 'Could not send report.', false);
  msg($('reportMsg'), `Sent to ${res.data.to} (${res.data.total} posted).`);
}

const PLATFORM_LABEL = { linkedin: 'LinkedIn', instagram: 'Instagram' };

function safePostUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const okHost = url.hostname === 'www.linkedin.com' || url.hostname === 'www.instagram.com';
    return url.protocol === 'https:' && okHost ? url.href : null;
  } catch {
    return null;
  }
}

async function loadQueue() {
  const container = $('reviewQueue');
  container.replaceChildren();
  const res = await api('/review-queue');
  if (!res.ok) {
    msg($('queueMsg'), res.error || 'Could not load drafts.', false);
    return;
  }

  const drafts = res.data.drafts || [];
  if (!drafts.length) {
    container.textContent = 'No drafts waiting for review.';
    return;
  }

  for (const draft of drafts) {
    const card = document.createElement('article');
    card.style.cssText = 'border:1px solid #d0d7de;border-radius:8px;padding:12px;margin:10px 0;';

    const meta = document.createElement('p');
    meta.className = 'hint';
    meta.textContent = `${PLATFORM_LABEL[draft.platform] || 'LinkedIn'} · ${draft.category || 'Comment'} · ${draft.surface || ''} · ${draft.created_at}`;
    card.appendChild(meta);

    const postUrl = safePostUrl(draft.post_url || '');
    if (postUrl) {
      const link = document.createElement('a');
      link.href = postUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open original post';
      card.appendChild(link);
    }

    const editor = document.createElement('textarea');
    editor.value = draft.comment;
    editor.setAttribute('aria-label', 'Edit comment draft');
    editor.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:8px 0;';
    card.appendChild(editor);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    const makeAction = (label, handler, secondary = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (secondary) button.className = 'secondary';
      button.addEventListener('click', handler);
      actions.appendChild(button);
      return button;
    };

    makeAction('Save edit', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const result = await api('/update-draft', {
        method: 'POST',
        body: { id: draft.id, comment: editor.value },
      });
      button.disabled = false;
      if (!result.ok) return msg($('queueMsg'), result.error || 'Could not save edit.', false);
      msg($('queueMsg'), 'Draft updated.');
      await loadQueue();
    }, true);

    makeAction('Copy draft', async () => {
      try {
        await navigator.clipboard.writeText(editor.value);
        msg($('queueMsg'), 'Copied. Review and post it manually in LinkedIn.');
      } catch {
        msg($('queueMsg'), 'Clipboard access was blocked.', false);
      }
    }, true);

    makeAction('Mark posted manually', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const result = await api('/log-engagement', {
        method: 'POST',
        body: { id: draft.id, status: 'posted' },
      });
      if (!result.ok) {
        button.disabled = false;
        return msg($('queueMsg'), result.error || 'Could not update draft status.', false);
      }
      msg($('queueMsg'), 'Marked as posted.');
      await loadQueue();
    });

    makeAction('Discard', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const result = await api('/log-engagement', {
        method: 'POST',
        body: { id: draft.id, status: 'skipped' },
      });
      if (!result.ok) {
        button.disabled = false;
        return msg($('queueMsg'), result.error || 'Could not discard draft.', false);
      }
      msg($('queueMsg'), 'Draft discarded.');
      await loadQueue();
    }, true);

    card.appendChild(actions);
    container.appendChild(card);
  }
}

$('connect').addEventListener('click', connect);
$('save').addEventListener('click', save);
$('refresh').addEventListener('click', loadFromServer);
$('refreshQueue').addEventListener('click', loadQueue);
$('sendReportNow').addEventListener('click', sendReportNow);

(async () => {
  renderPresets();
  await loadLocal();
  const { token } = await getConfig();
  if (token) {
    await loadFromServer();
  } else {
    $('reviewQueue').textContent = 'Connect to your backend to see draft comments.';
  }
})();
