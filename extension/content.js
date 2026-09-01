/**
 * Runs on a supported application page. Finds fields, fills them from your ALYX
 * profile, and shows you exactly what it did and what it could not do.
 *
 * Two rules govern everything here.
 *
 * 1. It never submits. Not as a first-version limitation, as the position. The
 *    products that auto-submit send unreviewed screening answers, and a wrong
 *    salary number reaches forty employers before anyone notices.
 *
 * 2. It fails loudly. A field it could not fill is reported in the panel. A
 *    quiet partial fill is worse than no fill at all, because it looks finished.
 */

(() => {
  const PANEL_ID = 'alyx-panel';
  if (document.getElementById(PANEL_ID)) return;

  const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));
  const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  // Curly and straight apostrophes both appear in the wild, sometimes in the same
  // form. "I don't wish to answer" must match "I don't wish to answer" or the
  // decline option silently fails to be found.
  const norm = (s) => (s || '').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

  // ------------------------------------------------------------ finding fields

  /** The visible question text for a control, wherever the ATS chose to put it. */
  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return norm(l.innerText);
    }
    const wrapping = el.closest('label');
    if (wrapping) return norm(wrapping.innerText);
    const aria = el.getAttribute('aria-label');
    if (aria) return norm(aria);
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const t = labelled.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
      if (t.trim()) return norm(t);
    }
    // Last resort: the nearest preceding text in the field's own group.
    const group = el.closest('div,fieldset,section');
    return norm(group?.querySelector('label,legend')?.innerText || '');
  }


  /**
   * Does a label contain this phrase as whole words?
   *
   * Substring matching is not good enough and the failure is not theoretical:
   * "state" appears inside "Are you legally authorized to work in the United
   * States", so a substring match would type a state code into a work
   * authorization question and submit it. Every phrase word must land on a word
   * boundary.
   */
  function labelHas(label, phrase) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i').test(label);
  }

  function controls() {
    return [...document.querySelectorAll('input, select, textarea')]
      .filter(el => el.type !== 'hidden' && el.type !== 'file' && !el.disabled && !el.readOnly)
      .filter(el => el.offsetParent !== null || el.type === 'radio' || el.type === 'checkbox');
  }

  /**
   * Resolve one mapped field to a control, trying anchors strongest first.
   * autocomplete is a web standard and survives redesigns; id is vendor
   * convention and usually survives; label text is what actually breaks, and it
   * breaks visibly because the question itself changed.
   */
  function resolve(spec, pool) {
    for (const token of spec.autocomplete || []) {
      const hit = pool.find(el => (el.getAttribute('autocomplete') || '').toLowerCase() === token);
      if (hit) return { el: hit, via: `autocomplete=${token}` };
    }
    for (const id of spec.id || []) {
      const hit = pool.find(el => (el.id || '').toLowerCase() === id.toLowerCase());
      if (hit) return { el: hit, via: `id=${id}` };
    }
    for (const text of spec.label || []) {
      const hit = pool.find(el => labelHas(labelFor(el), text));
      if (hit) return { el: hit, via: `label~"${text}"` };
    }
    return null;
  }

  // ------------------------------------------------------------ setting values

  /** Set a value the way a human would, so React and friends actually notice.
   *  Assigning .value directly is invisible to a framework's own state. */
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                : el instanceof HTMLSelectElement   ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function chooseOption(select, wanted) {
    const target = norm(wanted);
    const opt = [...select.options].find(o => norm(o.text) === target)
             || [...select.options].find(o => norm(o.text).includes(target));
    if (!opt) return false;
    setValue(select, opt.value);
    return true;
  }

  function answerBoolean(el, yes) {
    if (el.tagName === 'SELECT') return chooseOption(el, yes ? 'yes' : 'no');
    if (el.type === 'checkbox') { if (el.checked !== yes) el.click(); return true; }
    if (el.type === 'radio') {
      const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
      const pick = group.find(r => norm(labelFor(r)) === (yes ? 'yes' : 'no'));
      if (pick) { pick.click(); return true; }
    }
    return false;
  }


  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /**
   * Is this a react-select combobox rather than a real <select>?
   *
   * Greenhouse moved its EEO questions to react-select, which looks like a
   * dropdown and behaves like nothing. It has no options in the DOM until it is
   * opened, so it cannot be filled the way a <select> can.
   */
  function isCombobox(el) {
    return el.getAttribute('role') === 'combobox' && Boolean(el.closest('.select__control'));
  }

  /**
   * Drive a react-select by imitating a real user: open the control, read the
   * options that appear, click the one that matches.
   *
   * React listens for bubbled native events at the document root and does not
   * check isTrusted, so a dispatched sequence works. The full
   * pointerdown/mousedown/mouseup/click run is needed because react-select opens
   * on mousedown but other handlers expect the rest of the sequence.
   */
  async function pickCombobox(input, patterns) {
    const control = input.closest('.select__control') || input.parentElement;
    input.focus();
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      control.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
    await sleep(250);

    const visible = (e) => e.offsetParent !== null;
    const options = [...document.querySelectorAll('[class*="option"]')].filter(visible);
    if (!options.length) return { ok: false, why: 'dropdown would not open' };

    for (const p of patterns) {
      const hit = options.find(o => norm(o.innerText).includes(norm(p)));
      if (hit) {
        hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(150);
        return { ok: true, chose: norm(hit.innerText) };
      }
    }
    // Close it again rather than leaving an open menu over the form.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { ok: false, why: `no option matched (offered: ${options.slice(0, 4).map(o => norm(o.innerText)).join(', ')})` };
  }

  // ------------------------------------------------------------ the fill

  async function fill(profile, map) {
    const filled = [];
    const missed = [];
    const pool = controls();

    for (const spec of map.fields) {
      const value = dig(profile, spec.key);
      const found = resolve(spec, pool);
      if (!value) { if (found) missed.push({ label: spec.key, why: 'no value in your ALYX profile' }); continue; }
      if (!found) continue; // the form simply does not ask. Not a failure.
      if (found.el.value && norm(found.el.value) !== norm(value)) {
        missed.push({ label: spec.key, why: 'already had a different value, left alone' });
        continue;
      }
      const ok = found.el.tagName === 'SELECT' ? chooseOption(found.el, value) : (setValue(found.el, value), true);
      (ok ? filled : missed).push({ label: spec.key, via: found.via, why: ok ? null : 'no matching option' });
    }

    for (const q of map.questions) {
      const value = dig(profile, q.key);
      if (value === undefined || value === null || value === '') continue;
      const found = resolve({ label: q.label, autocomplete: [], id: [] }, pool);
      if (!found) continue;
      let ok;
      if (isCombobox(found.el)) {
        const r = await pickCombobox(found.el, q.type === 'boolean' ? [value ? 'yes' : 'no'] : [String(value)]);
        ok = r.ok;
      } else {
        ok = q.type === 'boolean' ? answerBoolean(found.el, Boolean(value))
           : found.el.tagName === 'SELECT' ? chooseOption(found.el, String(value))
           : (setValue(found.el, String(value)), true);
      }
      (ok ? filled : missed).push({ label: q.key, via: found.via, why: ok ? null : 'could not match an option' });
    }

    // Voluntary EEO. Always optional, so declining is the safe default and the
    // configured value is honoured when it is not "decline".
    for (const [key, patterns] of Object.entries(map.voluntary)) {
      if (key === '_comment') continue;
      const want = dig(profile, `voluntary.${key}`);
      if (!want) continue;
      const found = resolve({ label: patterns, autocomplete: [], id: [] }, pool);
      if (!found) continue; // not asked on this form

      const wanted = want === 'decline' ? map.declinePatterns : [want];

      if (isCombobox(found.el)) {
        const r = await pickCombobox(found.el, wanted);
        (r.ok ? filled : missed).push({ label: `voluntary.${key}`, via: found.via, why: r.ok ? null : r.why });
        continue;
      }
      if (found.el.tagName !== 'SELECT') {
        missed.push({ label: `voluntary.${key}`, why: 'unrecognised control, fill it yourself' });
        continue;
      }
      const ok = wanted.some(p => chooseOption(found.el, p));
      (ok ? filled : missed).push({ label: `voluntary.${key}`, via: found.via, why: ok ? null : 'no matching option offered' });
    }

    return { filled, missed };
  }

  // ------------------------------------------------------------ page identity

  function vendorFor(map) {
    for (const [name, v] of Object.entries(map.vendors)) {
      if (v.hosts.includes(location.host)) return { name, ...v };
    }
    return null;
  }

  function guessCompany(vendor) {
    if (vendor?.companyFrom?.startsWith('path:')) {
      const i = Number(vendor.companyFrom.split(':')[1]);
      const seg = location.pathname.split('/').filter(Boolean)[i - 1];
      if (seg) return seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    return document.title.split(/ at | \| /).pop()?.trim() || location.host;
  }

  function guessRole() {
    return document.querySelector('h1')?.innerText?.trim()
        || document.title.split(/ at | \| /)[0].replace(/^job application for /i, '').trim()
        || null;
  }

  // ------------------------------------------------------------ panel

  function panel() {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    // Inside an embedded form (Airbnb wraps Greenhouse in an iframe, and it is
    // not the only one), position:fixed anchors to the frame's viewport rather
    // than the window's, which can park the panel somewhere the reader never
    // scrolls past. Pin it to the top of the form instead.
    if (window.top !== window.self) el.classList.add('alyx-embedded');
    el.innerHTML = `
      <div class="alyx-head"><span class="alyx-mark">ALYX</span><button class="alyx-x" title="close">×</button></div>
      <div class="alyx-body"><div class="alyx-status">checking ALYX…</div></div>
      <div class="alyx-foot">
        <button class="alyx-fill" disabled>Autofill</button>
        <button class="alyx-record" disabled title="Record this application in your tracker">I submitted this</button>
      </div>
      <div class="alyx-note">ALYX never submits for you.</div>`;
    document.body.appendChild(el);
    el.querySelector('.alyx-x').onclick = () => el.remove();
    return el;
  }

  function render(box, { filled = [], missed = [] }) {
    const body = box.querySelector('.alyx-body');
    const rows = [];
    if (filled.length) rows.push(`<div class="alyx-ok">filled ${filled.length} field${filled.length === 1 ? '' : 's'}</div>`);
    for (const m of missed) rows.push(`<div class="alyx-warn">${m.label}: ${m.why || 'could not fill'}</div>`);
    if (!filled.length && !missed.length) rows.push('<div class="alyx-status">nothing on this page matched.</div>');
    body.innerHTML = rows.join('');
  }

  // ------------------------------------------------------------ boot

  (async () => {
    const map = await fetch(chrome.runtime.getURL('fields.json')).then(r => r.json());
    const vendor = vendorFor(map);
    if (!vendor) return;

    // With all_frames on, this also runs in analytics pixels and chat widgets.
    // A frame with no fillable control is not an application form, and putting a
    // panel on one is noise.
    if (controls().length < 3) return;

    const box = panel();
    const status = box.querySelector('.alyx-status');
    const fillBtn = box.querySelector('.alyx-fill');
    const recBtn = box.querySelector('.alyx-record');

    const known = await send({ type: 'lookup', url: location.href });
    if (known.ok && known.data.known) {
      const a = known.data.application;
      status.innerHTML = `<span class="alyx-warn">Already applied ${a.appliedAt} (${a.status}).</span>`;
    }

    const prof = await send({ type: 'profile' });
    if (!prof.ok) {
      status.innerHTML = `<span class="alyx-warn">${prof.detail || prof.error}</span>`;
      return;
    }

    status.textContent = `ready · ${vendor.name}`;
    fillBtn.disabled = false;
    recBtn.disabled = false;

    fillBtn.onclick = async () => {
      fillBtn.disabled = true;
      render(box, await fill(prof.data, map));
      fillBtn.disabled = false;
    };

    // Submit detection across single-page apps is unreliable, so the honest
    // design is an explicit button rather than a guess that silently misses.
    recBtn.onclick = async () => {
      recBtn.disabled = true;
      recBtn.textContent = 'recording…';
      const res = await send({ type: 'applied', payload: {
        company: guessCompany(vendor), role: guessRole(),
        url: location.href, source: vendor.name,
      }});
      recBtn.textContent = res.ok ? (res.data.created ? 'recorded ✓' : 'already tracked') : 'failed';
      if (!res.ok) { status.innerHTML = `<span class="alyx-warn">${res.detail || res.error}</span>`; recBtn.disabled = false; }
    };
  })();
})();
