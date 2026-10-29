// Shared API client + storage helpers, used by popup, options, and background.
// The backend base URL and the auth token live in chrome.storage.local.

export const DEFAULTS = {
  apiBase: 'http://localhost:8787',
};

export async function getStore(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
export async function setStore(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

export async function getConfig() {
  const { apiBase, token, license, profile } = await getStore([
    'apiBase',
    'token',
    'license',
    'profile',
  ]);
  return {
    apiBase: apiBase || DEFAULTS.apiBase,
    token: token || null,
    license: license || null,
    profile: profile || null,
  };
}

// Thin fetch wrapper with auth + uniform error handling. Never throws a raw
// network error at the caller; returns { ok, data, error, status }.
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const { apiBase, token } = await getConfig();
  const headers = { 'content-type': 'application/json' };
  if (auth && token) headers.authorization = `Bearer ${token}`;

  // The backend mounts every route under /api. Build the URL robustly whether
  // the user typed a trailing slash or already included /api.
  const base = (apiBase || DEFAULTS.apiBase).replace(/\/+$/, '');
  const prefix = base.endsWith('/api') ? '' : '/api';

  try {
    const res = await fetch(`${base}${prefix}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-json response */
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: `Cannot reach backend at ${apiBase}. Is it running?` };
  }
}
