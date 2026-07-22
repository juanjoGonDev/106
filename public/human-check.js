(() => {
  const previousFetch = window.fetch.bind(window);
  const START_ACTION = 'start';
  const CHECK_ACTION = 'human-check';
  const COMPLETE_ACTION = 'complete-human-check';
  const MAX_SERVER_ATTEMPTS = 2;
  let activeVerification = null;

  class HumanCheckCancelledError extends Error {}

  function readBody(init) {
    if (typeof init?.body !== 'string') return null;
    try {
      const parsed = JSON.parse(init.body);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async function readJson(response) {
    const payload = await response.clone().json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error || 'No se pudo completar la verificación visual.'));
    return payload;
  }

  function normalizeCanvas(canvas) {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(280, Math.round(bounds.width || 560));
    const height = Math.max(260, Math.round(bounds.height || 360));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function drawFootball(context, x, y, radius, order, completed, active) {
    context.save();
    context.translate(x, y);
    context.shadowColor = active ? '#f4c95dcc' : '#0009';
    context.shadowBlur = active ? 24 : 12;
    context.fillStyle = completed ? '#54d18b' : '#f7f8fb';
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = active ? '#f4c95d' : '#11151d';
    context.lineWidth = active ? 5 : 3;
    context.stroke();

    context.fillStyle = '#11151d';
    context.beginPath();
    for (let index = 0; index < 5; index += 1) {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
      const pointX = Math.cos(angle) * radius * 0.34;
      const pointY = Math.sin(angle) * radius * 0.34;
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
    context.fill();

    context.fillStyle = completed ? '#07110b' : '#ffffff';
    context.font = `900 ${Math.max(16, Math.round(radius * 0.58))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(order), 0, 1);
    context.restore();
  }

  function drawScene(canvas, balls, completedCount, message = '') {
    const { context, width, height } = normalizeCanvas(canvas);
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#620019');
    gradient.addColorStop(0.48, '#10121a');
    gradient.addColorStop(1, '#12305f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = '#ffffff22';
    context.lineWidth = 2;
    context.strokeRect(18, 18, width - 36, height - 36);
    context.beginPath();
    context.moveTo(width / 2, 18);
    context.lineTo(width / 2, height - 18);
    context.stroke();
    context.beginPath();
    context.arc(width / 2, height / 2, Math.min(width, height) * 0.13, 0, Math.PI * 2);
    context.stroke();

    for (let index = 0; index < balls.length; index += 1) {
      const ball = balls[index];
      const radius = Math.max(25, Math.min(38, width * Number(ball.radius) / 100));
      drawFootball(
        context,
        width * Number(ball.x) / 100,
        height * Number(ball.y) / 100,
        radius,
        ball.order,
        index < completedCount,
        index === completedCount,
      );
    }

    if (message) {
      context.fillStyle = '#0a0c12dd';
      context.fillRect(0, height - 42, width, 42);
      context.fillStyle = '#f4c95d';
      context.font = '800 14px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(message, width / 2, height - 21);
    }
  }

  function canvasPoint(canvas, event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  }

  function hitBall(point, ball) {
    return Math.hypot(point.x - Number(ball.x), point.y - Number(ball.y)) <= Number(ball.radius);
  }

  function lockViewport() {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const currentPadding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;

    body.classList.add('human-check-open');
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;

    return () => {
      body.classList.remove('human-check-open');
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }

  function createOverlay(balls, expiresAt) {
    const overlay = document.createElement('div');
    overlay.className = 'human-check-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'humanCheckTitle');

    const panel = document.createElement('section');
    panel.className = 'human-check-panel';
    const heading = document.createElement('div');
    heading.className = 'human-check-heading';
    heading.innerHTML = '<p class="eyebrow">VERIFICACIÓN DE JUEGO</p><h2 id="humanCheckTitle">Pulsa los balones en orden</h2><p>Usa ratón, lápiz o pantalla táctil. Si fallas, la secuencia vuelve al balón 1.</p>';
    const progress = document.createElement('strong');
    progress.className = 'human-check-progress';
    progress.setAttribute('aria-live', 'polite');
    const canvas = document.createElement('canvas');
    canvas.className = 'human-check-canvas';
    canvas.setAttribute('aria-label', 'Zona visual de verificación. Pulsa los balones numerados en orden.');
    const status = document.createElement('p');
    status.className = 'human-check-status';
    status.setAttribute('aria-live', 'polite');
    const continueButton = document.createElement('button');
    continueButton.className = 'primary human-check-continue';
    continueButton.type = 'button';
    continueButton.textContent = 'Empezar intento';
    continueButton.hidden = true;
    const cancel = document.createElement('button');
    cancel.className = 'ghost human-check-cancel';
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    panel.append(heading, progress, canvas, status, continueButton, cancel);
    overlay.append(panel);
    document.body.append(overlay);
    const unlockViewport = lockViewport();

    let completedCount = 0;
    let sequenceStartedAt = performance.now();
    let wrongUntil = 0;
    let resizeFrame = 0;
    const clicks = [];

    const redraw = () => drawScene(
      canvas,
      balls,
      completedCount,
      performance.now() < wrongUntil ? 'Secuencia reiniciada · vuelve al balón 1' : '',
    );
    const updateProgress = () => {
      progress.hidden = false;
      status.hidden = false;
      continueButton.hidden = true;
      progress.textContent = `${completedCount} / ${balls.length}`;
      status.textContent = completedCount === 0
        ? 'Empieza por el balón 1.'
        : `Bien. Ahora pulsa el balón ${balls[completedCount].order}.`;
    };
    const resetSequence = () => {
      completedCount = 0;
      clicks.length = 0;
      sequenceStartedAt = performance.now();
      wrongUntil = performance.now() + 1_000;
      updateProgress();
      status.textContent = 'Orden incorrecto. La secuencia vuelve al balón 1.';
      redraw();
      window.setTimeout(redraw, 1_050);
    };
    const showExplicitStart = () => {
      progress.hidden = true;
      status.hidden = true;
      continueButton.hidden = false;
      continueButton.focus();
    };
    const onResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(redraw);
    };

    updateProgress();
    redraw();
    window.addEventListener('resize', onResize);

    return new Promise((resolve, reject) => {
      let timer = 0;
      let settled = false;
      const onKeyDown = (event) => {
        if (event.key === 'Escape') fail(new HumanCheckCancelledError('Verificación visual cancelada.'));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        unlockViewport();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const succeed = (event) => {
        if (settled || event?.isTrusted !== true || completedCount !== balls.length) return;
        settled = true;
        const completedClicks = [...clicks];
        cleanup();
        resolve(completedClicks);
      };

      timer = window.setTimeout(
        () => fail(new Error('La verificación visual ha caducado. Se generará una nueva.')),
        Math.max(1_000, new Date(expiresAt).getTime() - Date.now()),
      );
      document.addEventListener('keydown', onKeyDown);
      cancel.addEventListener('click', () => fail(new HumanCheckCancelledError('Verificación visual cancelada.')));
      continueButton.addEventListener('click', succeed);

      canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (event.isTrusted !== true || !['mouse', 'touch', 'pen'].includes(event.pointerType)) return;
        if (completedCount === balls.length) return;
        const point = canvasPoint(canvas, event);
        const expected = balls[completedCount];
        if (!expected || !hitBall(point, expected)) {
          resetSequence();
          return;
        }

        clicks.push({
          x: Number(point.x.toFixed(2)),
          y: Number(point.y.toFixed(2)),
          atMs: Math.max(1, Math.round(performance.now() - sequenceStartedAt)),
          pointerType: event.pointerType,
          trusted: true,
        });
        completedCount += 1;
        progress.textContent = `${completedCount} / ${balls.length}`;
        status.textContent = completedCount === balls.length
          ? 'Orden correcto. Pulsa “Empezar intento” cuando estés preparado.'
          : `Bien. Ahora pulsa el balón ${balls[completedCount].order}.`;
        redraw();

        if (completedCount === balls.length) showExplicitStart();
      }, { passive: false });
    });
  }

  async function createServerCheck(input, common) {
    const createdResponse = await previousFetch(input, {
      ...common,
      body: JSON.stringify({ action: CHECK_ACTION }),
    });
    const created = await readJson(createdResponse);
    if (!Array.isArray(created.balls) || created.balls.length !== 4) {
      throw new Error('El servidor no devolvió una verificación visual válida.');
    }
    return created;
  }

  async function completeServerCheck(input, common, created, clicks) {
    const completedResponse = await previousFetch(input, {
      ...common,
      body: JSON.stringify({
        action: COMPLETE_ACTION,
        checkId: created.checkId,
        clicks,
      }),
    });
    const completed = await readJson(completedResponse);
    return {
      humanCheckId: completed.checkId,
      humanProofToken: completed.proofToken,
    };
  }

  async function obtainProof(input, init) {
    const headers = new Headers(init.headers || {});
    headers.set('content-type', 'application/json');
    const common = { ...init, method: 'POST', headers };
    let lastError = new Error('No se pudo completar la verificación visual.');

    for (let attempt = 0; attempt < MAX_SERVER_ATTEMPTS; attempt += 1) {
      try {
        const created = await createServerCheck(input, common);
        const clicks = await createOverlay(created.balls, created.expiresAt);
        return await completeServerCheck(input, common, created, clicks);
      } catch (error) {
        if (error instanceof HumanCheckCancelledError) throw error;
        lastError = error instanceof Error ? error : lastError;
      }
    }

    throw lastError;
  }

  window.fetch = async (input, init = {}) => {
    const body = readBody(init);
    if (!body || body.action !== START_ACTION || body.humanCheckId || body.humanProofToken) {
      return previousFetch(input, init);
    }

    if (activeVerification) throw new Error('Ya hay una verificación visual en curso.');
    activeVerification = obtainProof(input, init);
    try {
      const proof = await activeVerification;
      return previousFetch(input, {
        ...init,
        body: JSON.stringify({ ...body, ...proof }),
      });
    } finally {
      activeVerification = null;
    }
  };
})();
