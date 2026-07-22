(() => {
  const READY_WINDOW_MS = 120_000;
  const COUNTDOWN_INTERVAL_MS = 1_000;
  const COUNTDOWN_VALUES = Object.freeze([3, 2, 1]);
  const PHASES = Object.freeze({
    SOLVING: 'solving',
    READY: 'ready',
    COUNTDOWN: 'countdown',
    COMPLETE: 'complete',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
  });
  const TERMINAL_PHASES = new Set([PHASES.COMPLETE, PHASES.EXPIRED, PHASES.CANCELLED]);

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
    PHASES,
    createReadyCountdownFlow,
  });
})();
