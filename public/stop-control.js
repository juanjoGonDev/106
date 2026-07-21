(() => {
  const TAGS = ['div', 'section', 'aside', 'figure'];
  const PRESS_LABELS = ['PARA', 'CLAVA', 'REMATA', 'DISPARA'];
  const RELEASE_LABELS = ['MANTÉN · SUELTA', 'PRESIONA · LIBERA', 'CARGA · SUELTA'];

  function seedNumber(value) {
    return Array.from(String(value || '')).reduce((total, character) => ((total * 33) ^ character.charCodeAt(0)) >>> 0, 106);
  }

  function normalizeInteraction(input = {}) {
    const mode = input.mode === 'release' ? 'release' : 'press';
    const nonce = String(input.nonce || '');
    const seed = seedNumber(nonce);
    const keyboardKey = input.keyboardKey === 'Enter' ? 'Enter' : ' ';
    return {
      mode,
      nonce,
      keyboardKey,
      xPercent: Math.max(28, Math.min(72, Number(input.xPercent) || 50)),
      yPercent: Math.max(30, Math.min(70, Number(input.yPercent) || 50)),
      minHoldMs: mode === 'release' ? Math.max(100, Number(input.minHoldMs) || 160) : 0,
      maxHoldMs: mode === 'release' ? Math.max(500, Number(input.maxHoldMs) || 900) : 0,
      variant: Number(input.variant ?? seed % 8) % 8,
      seed,
    };
  }

  function drawControl(canvas, interaction, armed = false, disabled = false) {
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = 230;
    const height = 84;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);

    const gradients = [
      ['#f4c95d', '#d89b22'],
      ['#f0f2f7', '#b7bec9'],
      ['#ffcf69', '#d7622d'],
      ['#72c8ff', '#3b78cb'],
    ];
    const palette = gradients[interaction.variant % gradients.length];
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, disabled ? '#555861' : palette[0]);
    gradient.addColorStop(1, disabled ? '#30323a' : palette[1]);
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(2, 2, width - 4, height - 4, 22);
    context.fill();
    context.strokeStyle = armed ? '#ffffff' : '#ffffff66';
    context.lineWidth = armed ? 4 : 2;
    context.stroke();

    context.fillStyle = '#08090c';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 19px system-ui, sans-serif';
    const labels = interaction.mode === 'release' ? RELEASE_LABELS : PRESS_LABELS;
    context.fillText(labels[interaction.variant % labels.length], width / 2, 34);
    context.font = '700 11px system-ui, sans-serif';
    const keyLabel = interaction.keyboardKey === 'Enter' ? 'ENTER' : 'ESPACIO';
    const detail = interaction.mode === 'release'
      ? `${interaction.minHoldMs}–${interaction.maxHoldMs} ms · ${keyLabel}`
      : `UNA PULSACIÓN · ${keyLabel}`;
    context.fillText(detail, width / 2, 59);
  }

  function percent(value, start, size) {
    if (!Number.isFinite(value) || size <= 0) return -1;
    return Math.max(0, Math.min(100, ((value - start) / size) * 100));
  }

  function create({ container, interaction: rawInteraction, getElapsedMs, onFinish, onInvalid }) {
    if (!(container instanceof Element)) throw new Error('El contenedor del control final no existe.');
    const interaction = normalizeInteraction(rawInteraction);
    const host = document.createElement(TAGS[interaction.seed % TAGS.length]);
    host.tabIndex = 0;
    host.setAttribute('role', 'button');
    host.setAttribute('aria-label', `Control final ${interaction.nonce.slice(-6)}. ${interaction.mode === 'release' ? 'Mantén y suelta' : 'Pulsa'} para detener.`);
    host.setAttribute(`data-${interaction.nonce.slice(0, 8).replace(/[^a-z0-9]/gi, 'x').toLowerCase()}`, '');
    Object.assign(host.style, {
      display: 'block',
      position: 'relative',
      width: '100%',
      minHeight: '132px',
      marginTop: '14px',
      outline: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'none',
    });

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{contain:layout style}.pad{position:absolute;width:230px;height:84px;transform:translate(-50%,-50%);cursor:pointer;filter:drop-shadow(0 16px 28px #0008);transition:transform .12s ease,filter .12s ease}.pad:hover{filter:drop-shadow(0 18px 34px #000b)}.pad:active{transform:translate(-50%,-50%) scale(.97)}canvas{display:block;pointer-events:none}';
    const pad = document.createElement('div');
    pad.style.left = `${interaction.xPercent}%`;
    pad.style.top = `${interaction.yPercent}%`;
    pad.className = 'pad';
    const canvas = document.createElement('canvas');
    pad.append(canvas);
    shadow.append(style, pad);
    drawControl(canvas, interaction);

    let disabled = false;
    let completed = false;
    let enteredAt = 0;
    let downAt = 0;
    let downPointerId = null;
    let moveCount = 0;
    let travel = 0;
    let lastPoint = null;
    let maxPressure = 0;

    function coordinates(event) {
      const bounds = host.getBoundingClientRect();
      return {
        x: percent(Number(event.clientX), bounds.left, bounds.width),
        y: percent(Number(event.clientY), bounds.top, bounds.height),
      };
    }

    function finish(event, finishEvent, extra = {}) {
      if (disabled || completed || event.isTrusted !== true) return;
      completed = true;
      disabled = true;
      drawControl(canvas, interaction, false, true);
      const point = 'clientX' in event ? coordinates(event) : { x: interaction.xPercent, y: interaction.yPercent };
      const signal = {
        interactionMode: interaction.mode,
        controlNonce: interaction.nonce,
        finishEvent,
        pointerTrusted: event.isTrusted === true,
        userActivation: navigator.userActivation?.isActive === true,
        automationDetected: navigator.webdriver === true,
        pointerType: String(event.pointerType || (finishEvent === 'keydown' ? 'keyboard' : 'unknown')).slice(0, 16),
        pointerXPercent: Number(point.x.toFixed(2)),
        pointerYPercent: Number(point.y.toFixed(2)),
        pointerMoveCount: Math.min(500, moveCount),
        pointerTravelPx: Math.min(5000, Math.round(travel)),
        pointerDwellMs: enteredAt ? Math.min(30_000, Math.round(performance.now() - enteredAt)) : 0,
        pressureMax: Number(maxPressure.toFixed(3)),
        holdDurationMs: extra.holdDurationMs || 0,
        samePointer: extra.samePointer !== false,
        keyboardKey: finishEvent === 'keydown' ? String(event.key || '') : '',
        clientElapsedMs: Math.round(Number(getElapsedMs?.()) || 0),
      };
      Promise.resolve(onFinish?.(signal)).catch((error) => onInvalid?.(error));
    }

    host.addEventListener('pointerenter', () => { enteredAt = performance.now(); });
    host.addEventListener('pointermove', (event) => {
      moveCount += 1;
      maxPressure = Math.max(maxPressure, Number(event.pressure) || 0);
      if (lastPoint) travel += Math.hypot(event.clientX - lastPoint.x, event.clientY - lastPoint.y);
      lastPoint = { x: event.clientX, y: event.clientY };
    });
    host.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (disabled || completed || event.isTrusted !== true) return;
      downAt = performance.now();
      downPointerId = event.pointerId;
      maxPressure = Math.max(maxPressure, Number(event.pressure) || 0);
      host.setPointerCapture?.(event.pointerId);
      drawControl(canvas, interaction, true, false);
      if (interaction.mode === 'press') finish(event, 'pointerdown');
    });
    host.addEventListener('pointerup', (event) => {
      event.preventDefault();
      if (interaction.mode !== 'release' || disabled || completed) return;
      finish(event, 'pointerup', {
        holdDurationMs: Math.round(performance.now() - downAt),
        samePointer: downPointerId === event.pointerId,
      });
    });
    host.addEventListener('pointercancel', () => {
      downAt = 0;
      downPointerId = null;
      drawControl(canvas, interaction);
    });
    host.addEventListener('keydown', (event) => {
      const matches = interaction.keyboardKey === 'Enter' ? event.key === 'Enter' : event.key === ' ';
      if (!matches || event.repeat) return;
      event.preventDefault();
      finish(event, 'keydown');
    });

    container.append(host);
    requestAnimationFrame(() => host.focus({ preventScroll: true }));

    return {
      destroy() { host.remove(); },
      setDisabled(value) {
        disabled = Boolean(value);
        host.tabIndex = disabled ? -1 : 0;
        drawControl(canvas, interaction, false, disabled);
      },
      interaction,
    };
  }

  window.Minuto106StopControl = { create, normalizeInteraction };
})();