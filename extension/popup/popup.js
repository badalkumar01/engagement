import { api, getConfig, getStore, setStore } from '../src/shared.js';

const $ = (id) => document.getElementById(id);

const SURFACE_LABEL = {
  home: 'Home feed',
  search: 'Keyword search',
  profile: 'Target profiles',
  own_post: 'Your posts',
};
const CATEGORY_LABEL = {
  question: 'Question',
  appreciation: 'Appreciation',
  relatable: 'Relatable',
  value_add: 'Value-add',
};
const PLATFORM_LABEL = { linkedin: 'LinkedIn', instagram: 'Instagram' };

async function renderStatus() {
  const cfg = await getConfig();
  if (!cfg.token) {
    $('dot').className = 'dot bad';
    $('statusText').textContent = 'Not connected';
    return false;
  }
  const health = await api('/health', { auth: false });
  if (health.ok) {
    $('dot').className = 'dot ok';
    $('statusText').textContent = 'Connected';
    return true;
  }
  $('dot').className = 'dot bad';
  $('statusText').textContent = health.error || 'Backend unreachable';
  return false;
}

async function renderWarning() {
  const { lastWarning } = await getStore(['lastWarning']);
  if (lastWarning?.message) {
    $('warnCard').hidden = false;
    $('warnMsg').textContent = lastWarning.message;
  } else {
    $('warnCard').hidden = true;
  }
}

async function renderSummary() {
  const res = await api('/session-summary');
  if (!res.ok) return;
  const s = res.data;
  $('total').textContent = s.total;

  const platformPills = $('byPlatform');
  platformPills.replaceChildren();
  for (const [key, count] of Object.entries(s.byPlatform || {})) {
    const pill = document.createElement('span');
    pill.textContent = `${PLATFORM_LABEL[key] || key}: ${count}`;
    platformPills.appendChild(pill);
  }

  const surfaceRows = $('bySurface');
  surfaceRows.replaceChildren();
  const surfaces = Object.entries(s.bySurface || {});
  if (!surfaces.length) {
    const empty = document.createElement('div');
    empty.className = 'row muted';
    empty.textContent = 'No surface breakdown yet';
    surfaceRows.appendChild(empty);
  } else {
    for (const [key, count] of surfaces) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      label.textContent = SURFACE_LABEL[key] || key;
      const value = document.createElement('span');
      value.textContent = String(count);
      row.append(label, value);
      surfaceRows.appendChild(row);
    }
  }

  const categoryPills = $('byCategory');
  categoryPills.replaceChildren();
  for (const [key, count] of Object.entries(s.byCategory || {})) {
    const pill = document.createElement('span');
    pill.textContent = `${CATEGORY_LABEL[key] || key}: ${count}`;
    categoryPills.appendChild(pill);
  }

  const list = s.posts || [];
  const postList = $('postList');
  postList.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = 'Nothing posted yet today.';
    postList.appendChild(empty);
  } else {
    for (const post of list) {
      const item = document.createElement('li');
      let label = SURFACE_LABEL[post.surface] || 'post';
      try {
        const url = new URL(post.post_url);
        if (url.protocol === 'https:' && url.hostname === 'www.linkedin.com') {
          const link = document.createElement('a');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = label;
          item.appendChild(link);
          label = null;
        }
      } catch {
        // An invalid or absent permalink is rendered as plain text.
      }
      if (label) item.appendChild(document.createTextNode(label));
      const category = document.createElement('span');
      category.className = 'muted';
      category.textContent = ` (${CATEGORY_LABEL[post.category] || post.category || '—'})`;
      item.appendChild(category);
      postList.appendChild(item);
    }
  }
}

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('clearWarn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_WARNING' }).catch(() => {});
  await renderWarning();
});

(async () => {
  await renderWarning();
  const connected = await renderStatus();
  if (connected) await renderSummary();
})();
