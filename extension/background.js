/**
 * The only part of the extension that talks to ALYX.
 *
 * The content script runs in the page's origin, and the ALYX server sends no
 * CORS headers, so a page-origin fetch to localhost is refused by the browser.
 * That is the intended design: it means a hostile site cannot read your profile
 * off localhost just because you visited it. This worker is not subject to CORS
 * (it fetches under host_permissions), so it is the single legitimate door, and
 * it is the only place the token is ever held.
 */

const DEFAULT_BASE = 'http://127.0.0.1:4571';

async function settings() {
  const { base = DEFAULT_BASE, token = '' } = await chrome.storage.local.get(['base', 'token']);
  return { base, token };
}

async function call(path, { method = 'GET', body = null } = {}) {
  const { base, token } = await settings();
  if (!token) return { ok: false, error: 'no-token', detail: 'Open the ALYX extension options and paste your token.' };

  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { 'authorization': `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Distinguishing "ALYX is not running" from every other failure matters,
    // because it is the overwhelmingly likely cause and it has a one-line fix.
    return { ok: false, error: 'unreachable', detail: 'ALYX is not running. Start it with: node src/serve.mjs' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `http-${res.status}`, detail: data.detail || data.error || res.statusText };
  return { ok: true, data };
}

const HANDLERS = {
  profile:  ()      => call('/profile'),
  lookup:   ({ url }) => call(`/application?url=${encodeURIComponent(url)}`),
  applied:  ({ payload }) => call('/applied', { method: 'POST', body: payload }),
  health:   async () => {
    const { base } = await settings();
    try {
      const res = await fetch(`${base}/health`);
      return { ok: res.ok, data: await res.json() };
    } catch { return { ok: false, error: 'unreachable' }; }
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) { respond({ ok: false, error: 'unknown-message' }); return false; }
  handler(msg).then(respond);
  return true; // keep the channel open for the async reply
});
