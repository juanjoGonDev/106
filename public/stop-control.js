(() => {
  const CONTROL_WIDTH = 250;
  const CONTROL_HEIGHT = 88;
  const DEFAULT_PRESENTATION = Object.freeze({ label: 'PARAR', detail: 'PULSA UNA VEZ' });

  function seedNumber(value) {
    return Array.from(String(value || '')).reduce(
      (total, character) => ((total * 33) ^ character.charCodeAt(0)) >>> 0,
      106,
    );
  }

  function boundedPercent(value, fallback = 50) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(20, Math.min(80, number)) : fallback;
  }

  function normalizeInteraction(input = {}) {
    const nonce = String(input.nonce || '');
    const seed = seedNumber(nonce);
    return {
      mode: 'press',
      nonce,
      xPercent: boundedPercent(input.xPercent),
      yPercent: boundedPercent(input.yPercent),
      variant: Number(input.variant ?? seed % 4) % 4,
      seed,
    };
  }

  function normalizePresentation(input = DEFAULT_PRESENTATION) {
    const label = String(input?.label ?? DEFAULT_PRESENTATION.label).trim().slice(0, 24) || DEFAULT_PRESENTATION.label;
    const detail = String(input?.detail ?? '').trim().slice(0, 42);
    return Object.freeze({ label, detail });
  }

  function drawControl(canvas, interaction, presentation, armed = false, muted = false) {
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = CONTROL_WIDTH * ratio;
    canvas.height = CONTROL_HEIGHT * ratio;
    canvas.style.width = `${CONTROL_WIDTH}px`;
    canvas.style.height = `${CONTROL_HEIGHT}px`;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const gradients = [
      ['#f4c95d', '#d89b22'],
      ['#f0f2f7', '#b7bec9'],
      ['#ffcf69', '#d7622d'],
      ['#72c8ff', '#3b78cb'],
    ];
    const palette = gradients[interaction.variant % gradients.length];
    const gradient = context.createLinearGradient(0, 0, CONTROL_WIDTH, CONTROL_HEIGHT);
    gradient.addColorStop(0, muted ? '#555861' : palette[0]);
    gradient.addColorStop(1, muted ? '#30323a' : palette[1]);
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(2, 2, CONTROL_WIDTH - 4, CONTROL_HEIGHT - 4, 22);
    context.fill();
    context.strokeStyle = armed ? '#ffffff' : '#ffffff66';
    context.lineWidth = armed ? 4 : 2;
    context.stroke();

    context.fillStyle = '#08090c';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const isCountdown = /^[1-3]$/.test(presentation.label);
    context.font = isCountdown ? '950 46px system-ui, sans-serif' : '950 21px system-ui, sans-serif';
    context.fillText(presentation.label, CONTROL_WIDTH / 2, presentation.detail ? 35 : CONTROL_HEIGHT / 2);
    if (presentation.detail) {
      context.font = '750 11px system-ui, sans-serif';
      context.fillText(presentation.detail, CONTROL_WIDTH / 2, 62);
    }
  }

  function mappedControlCoordinate(value, start, size, target) {
    if (!Number.isFinite(value) || size <= 0) return target;
    const local = Math.max(0, Math.min(1, (value - start) / size));
    return Math.max(20, Math.min(80, target - 8 + local * 16));
  }

  function updateInstruction() {
    const instruction = document.querySelector('#playInstruction');
    if (!instruction) return;
    instruction.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = 'Acción de este intento: ';
    instruction.append(
      strong,
      document.createTextNode('pulsa una vez el control visual situado en el centro cuando creas que llegas a 10.600.'),
    );
  }

  function create(options) {
    const {
      container,
      interaction: rawInteraction,
      getElapsedMs,
      onFinish,
      onInvalid,
      onPress,
      minimumElapsedMs = 0,
      updatePlayInstruction = true,
    } = options ?? {};
    if (!(container instanceof Element)) throw new Error('El contenedor del control final no existe.');
    const interaction = normalizeInteraction(rawInteraction);
    let presentation = normalizePresentation(options?.presentation);
    const hostTag = `m106-${interaction.nonce.slice(0, 12).replace(/[^a-z0-9]/gi, 'x').toLowerCase() || 'control'}`;
    const host = document.createElement(hostTag);
    Object.assign(host.style, {
      display: 'grid',
      placeItems: 'center',
      position: 'relative',
      width: '100%',
      minHeight: '144px',
      marginTop: '14px',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'none',
    });

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{contain:layout style}.pad{position:relative;width:min(250px,78vw);height:88px;cursor:pointer;filter:drop-shadow(0 16px 28px #0008);transition:transform .12s ease,filter .12s ease;touch-action:none;user-select:none}.pad:hover{filter:drop-shadow(0 18px 34px #000b)}.pad:active{transform:scale(.97)}.pad[data-disabled="true"]{cursor:not-allowed}canvas{display:block;width:100%!important;height:88px!important;pointer-events:none}';
    const pad = document.createElement('div');
    pad.className = 'pad';
    pad.dataset.disabled = 'false';
    const canvas = document.createElement('canvas');
    pad.append(canvas);
    shadow.append(style, pad);
    drawControl(canvas, interaction, presentation);
    if (updatePlayInstruction) updateInstruction();

    let disabled = false;
    let muted = false;
    let completed = false;
    let enteredAt = 0;
    let moveCount = 0;
    let travel = 0;
    let lastPoint = null;
    let maxPressure = 0;

    function redraw(armed = false) {
      drawControl(canvas, interaction, presentation, armed, muted);
    }

    function coordinates(event) {
      const bounds = pad.getBoundingClientRect();
      return {
        x: mappedControlCoordinate(Number(event.clientX), bounds.left, bounds.width, interaction.xPercent),
        y: mappedControlCoordinate(Number(event.clientY), bounds.top, bounds.height, interaction.yPercent),
      };
    }

    function finish(event) {
      if (disabled || completed || event.isTrusted !== true) return;
      if (!['mouse', 'touch', 'pen'].includes(event.pointerType)) return;
      if (typeof onPress === 'function') {
        Promise.resolve(onPress({ pointerType: event.pointerType, trusted: true })).catch((error) => onInvalid?.(error));
        return;
      }

      const elapsedMs = Math.round(Number(getElapsedMs?.()) || 0);
      if (elapsedMs < Math.max(0, Number(minimumElapsedMs) || 0)) {
        onInvalid?.(new Error('Espera a que el cronómetro se oculte antes de parar.'));
        return;
      }

      completed = true;
      disabled = true;
      muted = true;
      pad.dataset.disabled = 'true';
      pad.style.pointerEvents = 'none';
      redraw();
      const point = coordinates(event);
      const signal = {
        interactionMode: 'press',
        controlNonce: interaction.nonce,
        finishEvent: 'pointerdown',
        pointerTrusted: true,
        userActivation: navigator.userActivation?.isActive === true,
        automationDetected: navigator.webdriver === true,
        pointerType: event.pointerType,
        pointerXPercent: Number(point.x.toFixed(2)),
        pointerYPercent: Number(point.y.toFixed(2)),
        pointerMoveCount: Math.min(500, moveCount),
        pointerTravelPx: Math.min(5000, Math.round(travel)),
        pointerDwellMs: enteredAt ? Math.min(30_000, Math.round(performance.now() - enteredAt)) : 0,
        pressureMax: Number(maxPressure.toFixed(3)),
        holdDurationMs: 0,
        samePointer: true,
        automaticFinish: false,
        clientElapsedMs: elapsedMs,
      };
      Promise.resolve(onFinish?.(signal)).catch((error) => onInvalid?.(error));
    }

    pad.addEventListener('pointerenter', () => { enteredAt = performance.now(); });
    pad.addEventListener('pointermove', (event) => {
      moveCount += 1;
      maxPressure = Math.max(maxPressure, Number(event.pressure) || 0);
      if (lastPoint) travel += Math.hypot(event.clientX - lastPoint.x, event.clientY - lastPoint.y);
      lastPoint = { x: event.clientX, y: event.clientY };
    });
    pad.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (disabled || completed || event.isTrusted !== true) return;
      maxPressure = Math.max(maxPressure, Number(event.pressure) || 0);
      redraw(true);
      finish(event);
    }, { passive: false });

    container.append(host);

    return {
      destroy() { host.remove(); },
      setDisabled(value, options = {}) {
        disabled = Boolean(value);
        muted = options.muted === undefined ? disabled : Boolean(options.muted);
        pad.style.pointerEvents = disabled ? 'none' : 'auto';
        pad.dataset.disabled = String(disabled);
        redraw();
      },
      setPresentation(value) {
        presentation = normalizePresentation(value);
        redraw();
      },
      interaction,
    };
  }

  window.Minuto106StopControl = { create, normalizeInteraction, normalizePresentation };
})();
