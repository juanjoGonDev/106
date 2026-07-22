(() => {
  const READY_WINDOW_MS = 120_000;
  const COUNTDOWN_INTERVAL_MS = 1_000;
  const COUNTDOWN_VALUES = Object.freeze([3, 2, 1]);
  const READY_POINTER_TYPES = Object.freeze(['mouse', 'touch', 'pen']);
  const PHASES = Object.freeze({
    SOLVING: 'solving',
    READY: 'ready',
    COUNTDOWN: 'countdown',
    COMPLETE: 'complete',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
  });
  const TERMINAL_PHASES = new Set([PHASES.COMPLETE, PHASES.EXPIRED, PHASES.CANCELLED]);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function createReadyTarget({ width, height, randomX, randomY }) {
    const safeWidth = Math.max(240, Number(width) || 0);
    const safeHeight = Math.max(180, Number(height) || 0);
    const targetWidth = Math.min(300, Math.max(190, safeWidth * 0.68));
    const targetHeight = Math.min(88, Math.max(68, safeHeight * 0.2));
    const margin = 18;
    const availableX = Math.max(0, safeWidth - targetWidth - margin * 2);
    const availableY = Math.max(0, safeHeight - targetHeight - margin * 2);
    const normalizedX = clamp(Number(randomX) || 0, 0, 0.999_999);
    const normalizedY = clamp(Number(randomY) || 0, 0, 0.999_999);

    return Object.freeze({
      x: margin + availableX * normalizedX,
      y: margin + availableY * normalizedY,
      width: targetWidth,
      height: targetHeight,
    });
  }

  function isPointInsideTarget(point, target) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x >= target.x
      && x <= target.x + target.width
      && y >= target.y
      && y <= target.y + target.height;
  }

  function isTrustedReadyPointer(event) {
    return event?.isTrusted === true
      && event.isPrimary !== false
      && READY_POINTER_TYPES.includes(String(event.pointerType));
  }

  function layoutsDiffer(previous, next, minimumDistance = 12) {
    if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length || next.length === 0) {
      return false;
    }

    return previous.every((priorBall) => {
      const nextBall = next.find((candidate) => Number(candidate?.order) === Number(priorBall?.order));
      if (!nextBall) return false;
      const priorX = Number(priorBall?.x);
      const priorY = Number(priorBall?.y);
      const nextX = Number(nextBall.x);
      const nextY = Number(nextBall.y);
      if (![priorX, priorY, nextX, nextY].every(Number.isFinite)) return false;
      return Math.hypot(nextX - priorX, nextY - priorY) >= minimumDistance;
    });
  }

  function createReadyCountdownFlow(options) {
    const schedule = options.schedule;
    const cancelScheduled = options.cancelScheduled;
    const onPhase = options.onPhase;
    const onCountdown = options.onCountdown;
    const onExpired = options.onExpired;
    const onComplete = options.onComplete;
    let phase = PHASES.SOLVING;
    let scheduledId = null;
    let countdownIndex = 0;

    function clearScheduled() {
      if (scheduledId === null) return;
      cancelScheduled(scheduledId);
      scheduledId = null;
    }

    function changePhase(nextPhase) {
      phase = nextPhase;
      onPhase(nextPhase);
    }

    function expireReadyWindow() {
      if (phase !== PHASES.READY) return false;
      clearScheduled();
      changePhase(PHASES.EXPIRED);
      onExpired();
      return true;
    }

    function runCountdownStep() {
      if (phase !== PHASES.COUNTDOWN) return;
      if (countdownIndex === COUNTDOWN_VALUES.length) {
        clearScheduled();
        changePhase(PHASES.COMPLETE);
        onComplete();
        return;
      }

      onCountdown(COUNTDOWN_VALUES[countdownIndex]);
      countdownIndex += 1;
      scheduledId = schedule(runCountdownStep, COUNTDOWN_INTERVAL_MS);
    }

    function markSolved() {
      if (phase !== PHASES.SOLVING) return false;
      changePhase(PHASES.READY);
      scheduledId = schedule(expireReadyWindow, READY_WINDOW_MS);
      return true;
    }

    function startCountdown() {
      if (phase !== PHASES.READY) return false;
      clearScheduled();
      countdownIndex = 0;
      changePhase(PHASES.COUNTDOWN);
      runCountdownStep();
      return true;
    }

    function cancel() {
      if (TERMINAL_PHASES.has(phase)) return false;
      clearScheduled();
      changePhase(PHASES.CANCELLED);
      return true;
    }

    function dispose() {
      clearScheduled();
    }

    return Object.freeze({
      getPhase: () => phase,
      markSolved,
      startCountdown,
      cancel,
      dispose,
    });
  }

  globalThis.Minuto106HumanCheckReadyFlow = Object.freeze({
    READY_WINDOW_MS,
    COUNTDOWN_INTERVAL_MS,
    COUNTDOWN_VALUES,
    READY_POINTER_TYPES,
    PHASES,
    createReadyTarget,
    isPointInsideTarget,
    isTrustedReadyPointer,
    layoutsDiffer,
    createReadyCountdownFlow,
  });
})();
