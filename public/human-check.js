(() => {
  const previousFetch = window.fetch.bind(window);
  const readyFlowApi = window.Minuto106HumanCheckReadyFlow;
  const START_ACTION = 'start';
  const CHECK_ACTION = 'human-check';
  const COMPLETE_ACTION = 'complete-human-check';
  const PREPARE_ACTION = 'prepare-start';
  const ACTIVATE_ACTION = 'activate-start';
  const COUNTDOWN_MS = 3_000;
  const MAX_SERVER_FAILURES = 2;
  const LOADING_DELAY_MS = 180;
  let activeVerification = null;
  let stopControlPatched = false;
  let gateNextStopControl = false;

  if (!readyFlowApi) throw new Error('No se pudo preparar el flujo de verificación del juego.');

  class HumanCheckCancelledError extends Error {}
  class HumanCheckRefreshError extends Error {}

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
    if (!response.ok) throw new Error(String(payload?.error || 'No se pudo completar la preparación del intento.'));
    return payload;
  }

  function readyApiUrl(input) {
    const raw = typeof input === 'string' ? input : String(input?.url || input || '');
    const url = new URL(raw, location.href);
    url.pathname = url.pathname.replace(/\/[^/]+\/?$/, '/game-ready-api');
    return url.toString();
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

  function drawCaptchaScene(canvas, balls, completedCount) {
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

  function createHumanCheckDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'human-check-overlay';
    overlay.dataset.phase = 'loading';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'humanCheckTitle');

    const panel = document.createElement('section');
    panel.className = 'human-check-panel';
    const heading = document.createElement('div');
    heading.className = 'human-check-heading';
    heading.innerHTML = '<p class="eyebrow">VERIFICACIÓN DE JUEGO</p><h2 id="humanCheckTitle">Pulsa los balones en orden</h2><p>Si fallas, se generará una verificación completamente nueva.</p>';
    const progress = document.createElement('strong');
    progress.className = 'human-check-progress';
    progress.setAttribute('aria-live', 'polite');
    const canvas = document.createElement('canvas');
    canvas.className = 'human-check-canvas';
    canvas.setAttribute('aria-label', 'Zona visual de verificación. Pulsa los balones numerados en orden.');
    const status = document.createElement('p');
    status.className = 'human-check-status';
    status.setAttribute('aria-live', 'polite');
    const loading = document.createElement('div');
    loading.className = 'human-check-loading';
    loading.hidden = true;
    loading.innerHTML = '<span aria-hidden="true"></span><strong>Generando una verificación nueva…</strong>';
    const cancel = document.createElement('button');
    cancel.className = 'ghost human-check-cancel';
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    panel.append(heading, progress, canvas, status, loading, cancel);
    overlay.append(panel);
    document.body.append(overlay);
    const unlockViewport = lockViewport();
    const frameRenderer = readyFlowApi.createLatestFrameRenderer({
      scheduleFrame: window.requestAnimationFrame.bind(window),
      cancelFrame: window.cancelAnimationFrame.bind(window),
    });

    let cancelled = false;
    let settledChallenge = null;
    let loadingTimer = 0;
    let expiryTimer = 0;

    function clearChallenge() {
      window.clearTimeout(expiryTimer);
      expiryTimer = 0;
      settledChallenge = null;
      canvas.onpointerdown = null;
      frameRenderer.invalidate();
    }

    function showLoading(message = 'Generando una verificación nueva…') {
      clearChallenge();
      window.clearTimeout(loadingTimer);
      overlay.dataset.phase = 'loading';
      status.textContent = message;
      loading.querySelector('strong').textContent = message;
      loadingTimer = window.setTimeout(() => {
        if (cancelled) return;
        loading.hidden = false;
        canvas.classList.add('is-loading');
      }, LOADING_DELAY_MS);
    }

    function hideLoading() {
      window.clearTimeout(loadingTimer);
      loading.hidden = true;
      canvas.classList.remove('is-loading');
    }

    function assertActive() {
      if (cancelled) throw new HumanCheckCancelledError('Verificación visual cancelada.');
    }

    function solve({ balls, expiresAt }) {
      assertActive();
      clearChallenge();
      hideLoading();
      overlay.dataset.phase = 'solving';
      let completedCount = 0;
      const sequenceStartedAt = performance.now();
      const clicks = [];

      const redraw = () => drawCaptchaScene(canvas, balls, completedCount);
      frameRenderer.replace(redraw);
      progress.textContent = `0 / ${balls.length}`;
      status.textContent = 'Empieza por el balón 1.';
      frameRenderer.renderNow();
      frameRenderer.request();

      return new Promise((resolve, reject) => {
        settledChallenge = { reject };
        const settle = (value) => {
          if (!settledChallenge) return;
          clearChallenge();
          resolve(value);
        };
        expiryTimer = window.setTimeout(
          () => settle({ kind: 'refresh', previousBalls: balls }),
          Math.max(1_000, new Date(expiresAt).getTime() - Date.now()),
        );

        canvas.onpointerdown = (event) => {
          event.preventDefault();
          if (!readyFlowApi.isTrustedReadyPointer(event)) return;
          const point = canvasPoint(canvas, event);
          const expected = balls[completedCount];
          if (!expected || !hitBall(point, expected)) {
            status.textContent = 'Orden incorrecto. Generando posiciones nuevas…';
            settle({ kind: 'refresh', previousBalls: balls });
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
            ? 'Verificación completada.'
            : `Bien. Ahora pulsa el balón ${balls[completedCount].order}.`;
          frameRenderer.renderNow();

          if (completedCount === balls.length) settle({ kind: 'solved', clicks, previousBalls: balls });
        };
      });
    }

    function cancelDialog() {
      if (cancelled) return;
      cancelled = true;
      const error = new HumanCheckCancelledError('Verificación visual cancelada.');
      settledChallenge?.reject(error);
      clearChallenge();
      destroy();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') cancelDialog();
    }

    function onResize() {
      frameRenderer.request();
    }

    function destroy() {
      window.clearTimeout(loadingTimer);
      window.clearTimeout(expiryTimer);
      frameRenderer.dispose();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      unlockViewport();
    }

    cancel.addEventListener('click', cancelDialog);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    showLoading('Generando verificación…');

    return Object.freeze({ showLoading, solve, assertActive, destroy });
  }

  async function readyRequest(url, common, body) {
    return previousFetch(url, {
      ...common,
      body: JSON.stringify(body),
    });
  }

  async function createServerCheck(url, common, previousBalls) {
    const response = await readyRequest(url, common, {
      action: CHECK_ACTION,
      previousBalls: previousBalls.length ? previousBalls : undefined,
    });
    const created = await readJson(response);
    if (!Array.isArray(created.balls) || created.balls.length !== 4) {
      throw new Error('El servidor no devolvió una verificación visual válida.');
    }
    return created;
  }

  async function completeServerCheck(url, common, created, clicks) {
    const response = await readyRequest(url, common, {
      action: COMPLETE_ACTION,
      checkId: created.checkId,
      clicks,
    });
    const completed = await readJson(response);
    return {
      humanCheckId: completed.checkId,
      humanProofToken: completed.proofToken,
      proofExpiresAt: completed.expiresAt,
    };
  }

  function isRefreshError(error) {
    if (error instanceof HumanCheckRefreshError) return true;
    return /caduc|expir|orden|pulsaciones/i.test(String(error instanceof Error ? error.message : error || ''));
  }

  async function obtainProof(url, common) {
    const dialog = createHumanCheckDialog();
    let previousBalls = [];
    let serverFailures = 0;

    try {
      while (serverFailures < MAX_SERVER_FAILURES) {
        try {
          dialog.showLoading(previousBalls.length ? 'Generando posiciones nuevas…' : 'Generando verificación…');
          const created = await createServerCheck(url, common, previousBalls);
          dialog.assertActive();
          if (previousBalls.length && !readyFlowApi.layoutsDiffer(previousBalls, created.balls)) {
            previousBalls = created.balls;
            continue;
          }
          const result = await dialog.solve(created);
          if (result.kind === 'refresh') {
            previousBalls = result.previousBalls;
            continue;
          }
          const proof = await completeServerCheck(url, common, created, result.clicks);
          dialog.destroy();
          return proof;
        } catch (error) {
          if (error instanceof HumanCheckCancelledError) throw error;
          if (isRefreshError(error)) continue;
          serverFailures += 1;
          if (serverFailures >= MAX_SERVER_FAILURES) throw error;
        }
      }
      throw new Error('No se pudo completar la verificación visual.');
    } catch (error) {
      dialog.destroy();
      throw error;
    }
  }

  function showPlayingSurface(team) {
    for (const id of ['setup', 'playing', 'result']) {
      document.querySelector(`#${id}`)?.classList.toggle('active', id === 'playing');
    }
    const teamElement = document.querySelector('#playingTeam');
    if (teamElement) {
      const country = team === 'spain' ? 'España' : 'Argentina';
      const flagClass = team === 'spain' ? 'flag--spain' : 'flag--argentina';
      teamElement.innerHTML = `<span class="flag ${flagClass}" aria-hidden="true"></span><span>${country}</span>`;
    }
    const timer = document.querySelector('#timer');
    if (timer) {
      timer.textContent = '0.000';
      timer.classList.remove('concealed');
      timer.setAttribute('aria-label', 'Cronómetro preparado');
    }
  }

  function patchStopControlGate() {
    if (stopControlPatched) return;
    const api = window.Minuto106StopControl;
    if (!api?.create) throw new Error('No se pudo preparar el control final.');
    const originalCreate = api.create.bind(api);
    api.create = (options) => {
      const control = originalCreate(options);
      if (!gateNextStopControl) return control;
      gateNextStopControl = false;
      control.setDisabled(true);
      const timer = document.querySelector('#timer');
      const unlock = () => {
        if (!timer?.classList.contains('concealed')) return;
        observer.disconnect();
        control.setDisabled(false);
      };
      const observer = new MutationObserver(unlock);
      if (timer) observer.observe(timer, { attributes: true, attributeFilter: ['class'] });
      unlock();
      return control;
    };
    stopControlPatched = true;
  }

  function randomUnit() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 0x1_0000_0000;
  }

  function createReadinessStage(prepared, activation) {
    const playing = document.querySelector('#playing');
    if (!playing) throw new Error('No se encontró la superficie de juego.');
    patchStopControlGate();

    const layer = document.createElement('div');
    layer.className = 'game-readiness-layer';
    layer.dataset.phase = 'ready';
    const status = document.createElement('p');
    status.className = 'game-readiness-status';
    status.setAttribute('aria-live', 'assertive');
    status.textContent = 'Pulsa el control visual cuando estés preparado.';
    const host = document.createElement(`m106-ready-${crypto.randomUUID().slice(0, 12)}`);
    host.className = 'game-readiness-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    const shadowStyle = document.createElement('style');
    shadowStyle.textContent = ':host{display:block;width:min(94vw,560px);height:min(42vh,300px);touch-action:none;user-select:none}canvas{display:block;width:100%;height:100%;touch-action:none;user-select:none}';
    const canvas = document.createElement('canvas');
    shadow.append(shadowStyle, canvas);
    layer.append(status, host);

    const preview = document.createElement('div');
    preview.className = 'game-stop-preview';
    playing.append(preview, layer);

    const stopApi = window.Minuto106StopControl;
    const previewControl = stopApi.create({
      container: preview,
      interaction: prepared.interaction ?? {},
      getElapsedMs: () => 0,
      onFinish: () => {},
      onInvalid: () => {},
    });
    previewControl.setDisabled(true);

    let target = null;
    let flow = null;
    let activationPayload = null;
    let activationError = null;
    let countdownComplete = false;
    let settled = false;
    let resizeFrame = 0;

    function drawReady() {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(240, Math.round(bounds.width || 520));
      const height = Math.max(180, Math.round(bounds.height || 260));
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(8, 9, 12, .72)';
      context.fillRect(0, 0, width, height);

      if (!target) target = readyFlowApi.createReadyTarget({ width, height, randomX: randomUnit(), randomY: randomUnit() });
      const gradient = context.createLinearGradient(target.x, target.y, target.x + target.width, target.y + target.height);
      gradient.addColorStop(0, '#f4c95d');
      gradient.addColorStop(1, '#d89b22');
      context.fillStyle = gradient;
      context.beginPath();
      context.roundRect(target.x, target.y, target.width, target.height, 22);
      context.fill();
      context.strokeStyle = '#ffffffaa';
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = '#08090c';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `950 ${Math.max(17, Math.min(24, target.height * 0.3))}px system-ui, sans-serif`;
      context.fillText('ESTOY PREPARADO', target.x + target.width / 2, target.y + target.height / 2);
    }

    function drawCountdown(value) {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(240, Math.round(bounds.width || 520));
      const height = Math.max(180, Math.round(bounds.height || 260));
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = 'rgba(8, 9, 12, .82)';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#f4c95d';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `950 ${Math.min(150, height * 0.58)}px system-ui, sans-serif`;
      context.fillText(String(value), width / 2, height / 2);
    }

    function canvasLocalPoint(event) {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    }

    function cleanup() {
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener('resize', onResize);
      flow?.dispose();
    }

    function destroy() {
      cleanup();
      previewControl.destroy();
      preview.remove();
      layer.remove();
    }

    function revealWhenMounted() {
      gateNextStopControl = true;
      const observer = new MutationObserver((records) => {
        const mounted = records.some((record) => [...record.addedNodes].some(
          (node) => node instanceof Element && node.parentElement === playing && node.tagName.startsWith('M106-'),
        ));
        if (!mounted) return;
        observer.disconnect();
        requestAnimationFrame(destroy);
      });
      observer.observe(playing, { childList: true });
      window.setTimeout(() => {
        if (!layer.isConnected) return;
        status.textContent = 'Cargando intento…';
      }, 400);
    }

    function tryComplete(resolve, reject) {
      if (!countdownComplete || (!activationPayload && !activationError) || settled) return;
      settled = true;
      if (activationError) {
        cleanup();
        reject(activationError);
        return;
      }
      revealWhenMounted();
      cleanup();
      resolve(activationPayload);
    }

    function onResize() {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        target = null;
        if (flow?.getPhase() === readyFlowApi.PHASES.READY) drawReady();
      });
    }

    window.addEventListener('resize', onResize);
    drawReady();

    return new Promise((resolve, reject) => {
      flow = readyFlowApi.createReadyCountdownFlow({
        schedule: window.setTimeout.bind(window),
        cancelScheduled: window.clearTimeout.bind(window),
        onPhase: (phase) => { layer.dataset.phase = phase; },
        onCountdown: (value) => {
          status.textContent = `El intento empieza en ${value}`;
          drawCountdown(value);
        },
        onExpired: () => {
          settled = true;
          destroy();
          resolve({ expired: true });
        },
        onComplete: () => {
          countdownComplete = true;
          if (!activationPayload && !activationError) {
            layer.dataset.phase = 'loading';
            status.textContent = 'Cargando intento…';
          }
          tryComplete(resolve, reject);
        },
      });
      flow.markSolved();

      canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (!readyFlowApi.isTrustedReadyPointer(event)) return;
        if (flow.getPhase() !== readyFlowApi.PHASES.READY) return;
        if (!readyFlowApi.isPointInsideTarget(canvasLocalPoint(event), target)) return;
        if (!flow.startCountdown()) return;
        Promise.resolve(activation()).then((payload) => {
          activationPayload = payload;
          tryComplete(resolve, reject);
        }).catch((error) => {
          activationError = error instanceof Error ? error : new Error('No se pudo activar el intento.');
          tryComplete(resolve, reject);
        });
      }, { passive: false });
    });
  }

  function restoreSetupSurface() {
    for (const id of ['setup', 'playing', 'result']) {
      document.querySelector(`#${id}`)?.classList.toggle('active', id === 'setup');
    }
  }

  async function prepareVerifiedStart(input, init, body) {
    const headers = new Headers(init.headers || {});
    headers.set('content-type', 'application/json');
    const common = { ...init, method: 'POST', headers };
    const url = readyApiUrl(input);

    while (true) {
      const proof = await obtainProof(url, common);
      showPlayingSurface(body.team);

      const preparedResponse = await readyRequest(url, common, {
        ...body,
        action: PREPARE_ACTION,
        humanCheckId: proof.humanCheckId,
        humanProofToken: proof.humanProofToken,
      });
      const prepared = await readJson(preparedResponse);

      const stageResult = await createReadinessStage(prepared, async () => {
        const activationResponse = await readyRequest(url, common, {
          action: ACTIVATE_ACTION,
          challengeId: prepared.challengeId,
          countdownMs: COUNTDOWN_MS,
        });
        const activation = await readJson(activationResponse);
        return { preparedResponse, activation };
      });

      if (stageResult.expired) continue;
      return stageResult.preparedResponse;
    }
  }

  window.fetch = async (input, init = {}) => {
    const body = readBody(init);
    if (!body || body.action !== START_ACTION || body.humanCheckId || body.humanProofToken) {
      return previousFetch(input, init);
    }

    if (activeVerification) throw new Error('Ya hay una verificación visual en curso.');
    activeVerification = prepareVerifiedStart(input, init, body);
    try {
      return await activeVerification;
    } catch (error) {
      restoreSetupSurface();
      throw error;
    } finally {
      activeVerification = null;
    }
  };
})();
