(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const accountToken = () => window.Minuto106Access?.getAccountToken?.(false) || '';
  let requirement = null;
  let checking = false;
  let submitting = false;
  let lastFocused = null;
  let blockedControlObserver = null;
  let nicknameController = null;

  function endpoint() {
    try {
      const base = new URL(String(config.supabaseUrl || ''));
      const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
      if (base.protocol !== 'https:' && !local) return '';
      return `${base.origin}/functions/v1/player-name-management`;
    } catch { return ''; }
  }

  async function request(action, payload = {}) {
    const url = endpoint(); const token = accountToken();
    if (!url || !token) return { requirement: null };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-account-token': token },
      body: JSON.stringify({ action, ...payload }),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(result.error || 'No se pudo comprobar el cambio de nick.'); error.code = result.code; throw error; }
    return result;
  }

  function setStatus(message = '', tone = '') {
    const status = document.querySelector('#nicknameRequirementStatus'); if (!status) return;
    status.textContent = message; if (tone) status.dataset.tone = tone; else delete status.dataset.tone;
  }

  function ensureUi() {
    let overlay = document.querySelector('#nicknameRequirementOverlay');
    if (overlay) return overlay;
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./nickname-requirement.css', document.baseURI).toString(); stylesheet.dataset.nicknameRequirementStyles = 'true'; document.head.append(stylesheet);
    overlay = document.createElement('div'); overlay.id = 'nicknameRequirementOverlay'; overlay.className = 'nickname-requirement-overlay'; overlay.hidden = true;
    const card = document.createElement('section'); card.className = 'nickname-requirement-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'nicknameRequirementTitle'); card.setAttribute('aria-describedby', 'nicknameRequirementDescription');
    const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'CAMBIO DE NICK REQUERIDO';
    const title = document.createElement('h2'); title.id = 'nicknameRequirementTitle'; title.textContent = 'Elige un nuevo nombre de jugador';
    const description = document.createElement('p'); description.id = 'nicknameRequirementDescription'; description.textContent = 'Moderación ha restablecido tu nick. Debes elegir uno nuevo que cumpla las normas antes de volver a competir.';
    const identity = document.createElement('div'); identity.className = 'nickname-requirement-identity';
    const original = document.createElement('p'); original.innerHTML = '<span>Nombre anterior</span><strong id="nicknameRequirementOriginal">—</strong>';
    const temporary = document.createElement('p'); temporary.innerHTML = '<span>Nombre temporal actual</span><strong id="nicknameRequirementTemporary">—</strong>';
    identity.append(original, temporary);
    const form = document.createElement('form'); form.id = 'nicknameRequirementForm'; form.className = 'nickname-requirement-form'; form.noValidate = true;
    const label = document.createElement('label'); label.htmlFor = 'nicknameRequirementInput'; label.textContent = 'Nuevo nick';
    const input = document.createElement('input'); input.id = 'nicknameRequirementInput'; input.type = 'text'; input.minLength = 3; input.maxLength = 24; input.autocomplete = 'nickname'; input.spellcheck = false; input.required = true;
    const status = document.createElement('p'); status.id = 'nicknameRequirementStatus'; status.className = 'nickname-requirement-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const submit = document.createElement('button'); submit.id = 'nicknameRequirementSubmit'; submit.className = 'primary'; submit.type = 'submit'; submit.textContent = 'Guardar nuevo nick'; submit.disabled = true;
    label.append(input); form.append(label, status, submit);
    const meta = document.createElement('p'); meta.className = 'nickname-requirement-meta'; meta.textContent = 'Tu cuenta, historial, logros y clasificaciones se conservarán. Solo cambia el nombre visible.';
    card.append(eyebrow, title, description, identity, form, meta); overlay.append(card); document.body.append(overlay);
    form.addEventListener('submit', submitRename); overlay.addEventListener('keydown', trapFocus); document.addEventListener('click', blockCompetitiveClick, true); return overlay;
  }

  function focusableElements() {
    const card = document.querySelector('.nickname-requirement-card'); if (!card) return [];
    return [...card.querySelectorAll('input,button,a[href],[tabindex]:not([tabindex="-1"])')].filter((element) => !element.disabled && !element.hidden);
  }
  function trapFocus(event) {
    if (!requirement || event.key !== 'Tab') return; const focusable = focusableElements(); if (!focusable.length) return; const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function blockCompetitiveClick(event) {
    if (!requirement) return; const target = event.target instanceof Element ? event.target.closest('#startButton,#quickDuelButton,#createDuelButton') : null; if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation(); document.querySelector('#nicknameRequirementInput')?.focus();
  }
  function enforceBlockedControls() {
    if (!requirement) return; const start = document.querySelector('#startButton'); if (!start) return;
    if (!start.dataset.nicknameRequirementPreviousLabel) start.dataset.nicknameRequirementPreviousLabel = start.textContent || 'Verificar y preparar';
    // The observer watches the same properties. Keep this callback idempotent so a
    // competing owner cannot trigger an endless MutationObserver feedback loop.
    if (!start.disabled) start.disabled = true;
    if (start.textContent !== 'Cambia tu nick para continuar') start.textContent = 'Cambia tu nick para continuar';
  }
  function observeBlockedControls() {
    blockedControlObserver?.disconnect(); blockedControlObserver = null; const start = document.querySelector('#startButton'); if (!start || !requirement) return;
    blockedControlObserver = new MutationObserver(enforceBlockedControls); blockedControlObserver.observe(start, { attributes: true, attributeFilter: ['disabled'], childList: true, characterData: true, subtree: true });
  }
  function restoreBlockedControls() {
    blockedControlObserver?.disconnect(); blockedControlObserver = null; const start = document.querySelector('#startButton');
    if (start?.dataset.nicknameRequirementPreviousLabel) { start.textContent = start.dataset.nicknameRequirementPreviousLabel; delete start.dataset.nicknameRequirementPreviousLabel; }
  }
  function setBackgroundInert(active) {
    for (const selector of ['.site-header', 'main', '.site-footer']) { const element = document.querySelector(selector); if (element instanceof HTMLElement) element.inert = active; }
  }

  function bindNicknameController() {
    nicknameController?.destroy?.(); nicknameController = null;
    const input = document.querySelector('#nicknameRequirementInput'); const status = document.querySelector('#nicknameRequirementStatus'); const submit = document.querySelector('#nicknameRequirementSubmit');
    const owner = window.Minuto106NicknameFieldController;
    if (!owner || !(input instanceof HTMLInputElement)) { submit.disabled = true; setStatus('No se pudo cargar la validación de nicks. Recarga la página.', 'error'); return; }
    nicknameController = owner.create({
      input, status, submitButton: submit,
      checkFn: ({ nick }) => request('check', { playerId: requirement.playerId, nick }),
      readyMessage: 'Nick válido y disponible. Puedes guardar el cambio.',
    });
  }

  function showRequirement(nextRequirement) {
    const overlay = ensureUi(); requirement = nextRequirement;
    const temporary = String(nextRequirement?.temporaryNick || '').trim(); const original = String(nextRequirement?.originalNick || '').trim();
    if (temporary) { localStorage.setItem('minuto106:nick', temporary); const nickInput = document.querySelector('#nick'); if (nickInput) nickInput.value = temporary; }
    document.querySelector('#nicknameRequirementOriginal').textContent = original || 'No disponible';
    document.querySelector('#nicknameRequirementTemporary').textContent = temporary || '—';
    lastFocused = document.activeElement; setBackgroundInert(true); overlay.hidden = false; enforceBlockedControls(); observeBlockedControls(); bindNicknameController();
    setStatus('Escribe un nuevo nick para continuar.'); requestAnimationFrame(() => document.querySelector('#nicknameRequirementInput')?.focus());
  }
  function hideRequirement() {
    const overlay = ensureUi(); overlay.hidden = true; requirement = null; nicknameController?.destroy?.(); nicknameController = null; setBackgroundInert(false); restoreBlockedControls();
    if (lastFocused instanceof HTMLElement && lastFocused.isConnected) lastFocused.focus(); lastFocused = null;
  }

  async function submitRename(event) {
    event.preventDefault(); if (!requirement || submitting || !nicknameController?.isReady?.()) { nicknameController?.refresh?.(); document.querySelector('#nicknameRequirementInput')?.focus(); return; }
    const input = document.querySelector('#nicknameRequirementInput'); const button = document.querySelector('#nicknameRequirementSubmit'); const normalized = nicknameController.normalizedValue();
    submitting = true; button.disabled = true; setStatus('Guardando el nuevo nick…');
    try {
      const result = await request('complete', { playerId: requirement.playerId, nick: normalized }); const newNick = String(result.newNick || normalized).trim();
      localStorage.setItem('minuto106:nick', newNick); const mainNickInput = document.querySelector('#nick'); if (mainNickInput) mainNickInput.value = newNick;
      window.Minuto106Access?.replaceRememberedNick?.(requirement.temporaryNick, newNick); setStatus('Nick actualizado. Ya puedes volver a competir.', 'success'); hideRequirement();
      document.dispatchEvent(new CustomEvent('minuto106:account-updated', { detail: { reason: 'nickname-renamed', nick: newNick } })); window.Minuto106Competition?.refresh?.('nickname-renamed')?.catch?.(() => {});
    } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo cambiar el nick.', 'error'); input?.focus(); }
    finally { submitting = false; if (requirement) button.disabled = !nicknameController?.isReady?.(); }
  }

  async function refresh() {
    if (checking || submitting) return; checking = true;
    try { const result = await request('status'); const next = result?.requirement?.required === true ? result.requirement : null; if (next) showRequirement(next); else if (requirement) hideRequirement(); }
    catch { if (requirement) enforceBlockedControls(); }
    finally { checking = false; }
  }
  function initialize() {
    ensureUi(); document.addEventListener('minuto106:account-updated', () => refresh().catch(() => {})); document.addEventListener('minuto106:cloud-account-synced', () => refresh().catch(() => {})); document.addEventListener('minuto106:player-context', enforceBlockedControls); document.addEventListener('minuto106:nickname-change-required', () => refresh().catch(() => {})); refresh().catch(() => {});
  }
  window.Minuto106NicknameRequirement = Object.freeze({ refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();