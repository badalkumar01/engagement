// Shared API client + storage helpers, used by popup, options, and background.
// The backend base URL and the auth token live in chrome.storage.local.

export const DEFAULTS = {
  // Hosted backend. Clients connect here by default; change it only to run a
  // local backend (http://localhost:8787).
  apiBase: 'https://engagement-assistant-backend.onrender.com',
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
// Re-run license-check with the stored key to get a fresh token. Used to
// transparently recover when a token expires or the backend DB was reset.
async function refreshToken(base, prefix) {
  const { license } = await getConfig();
  if (!license) return false;
  const { email } = await getStore(['email']);
  try {
    const res = await fetch(`${base}${prefix}/license-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: license, email: email || null }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await setStore({ token: data.token, profile: data.user });
    return true;
  } catch {
    return false;
  }
}

export async function api(path, { method = 'GET', body, auth = true, _retried = false } = {}) {
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
      // A stale/expired token: refresh once with the stored license and retry.
      if (res.status === 401 && auth && !_retried && (await refreshToken(base, prefix))) {
        return api(path, { method, body, auth, _retried: true });
      }
      return { ok: false, status: res.status, error: data?.error || `HTTP ${res.status}`, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: `Cannot reach backend at ${apiBase}. Is it running?` };
  }
}
