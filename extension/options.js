const $ = (id) => document.getElementById(id);

chrome.storage.local.get(['base', 'token']).then(({ base, token }) => {
  $('base').value = base || 'http://127.0.0.1:4571';
  $('token').value = token || '';
});

$('save').onclick = async () => {
  await chrome.storage.local.set({ base: $('base').value.trim().replace(/\/$/, ''), token: $('token').value.trim() });
  const status = $('status');
  status.className = 's';
  status.textContent = 'testing…';

  const health = await chrome.runtime.sendMessage({ type: 'health' });
  if (!health.ok) {
    status.className = 's bad';
    status.textContent = 'Cannot reach ALYX. Start it with: node src/serve.mjs';
    return;
  }
  // Health needs no token, so a working health check proves nothing about the
  // token. Profile is the one that actually exercises it.
  const prof = await chrome.runtime.sendMessage({ type: 'profile' });
  status.className = prof.ok ? 's ok' : 's bad';
  status.textContent = prof.ok
    ? 'Connected. Profile loaded.'
    : (prof.detail || prof.error);
};
