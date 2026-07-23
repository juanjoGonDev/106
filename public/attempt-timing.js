(() => {
  const MIN_MANUAL_STOP_MS = 2_000;
  const MAX_ATTEMPT_MS = 30_000;

  function finiteMilliseconds(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function canSubmitManualStop({ elapsedMs, timerConcealed }) {
    const elapsed = finiteMilliseconds(elapsedMs, -1);
    return timerConcealed === true && elapsed >= MIN_MANUAL_STOP_MS && elapsed <= MAX_ATTEMPT_MS;
  }

  function createAutomaticFinishSignal({ interaction, elapsedMs = MAX_ATTEMPT_MS }) {
    return Object.freeze({
      interactionMode: 'press',
      controlNonce: String(interaction?.nonce ?? ''),
      finishEvent: 'timeout',
      pointerTrusted: false,
      userActivation: false,
      automationDetected: navigator.webdriver === true,
      pointerType: 'timeout',
      pointerXPercent: Number(interaction?.xPercent ?? 50),
      pointerYPercent: Number(interaction?.yPercent ?? 50),
      pointerMoveCount: 0,
      pointerTravelPx: 0,
      pointerDwellMs: 0,
      pressureMax: 0,
      holdDurationMs: 0,
      samePointer: true,
      automaticFinish: true,
      clientElapsedMs: finiteMilliseconds(elapsedMs, MAX_ATTEMPT_MS),
    });
  }

  function createDeadline({ schedule, cancelScheduled, onDeadline, delayMs = MAX_ATTEMPT_MS }) {
    if (typeof schedule !== 'function' || typeof cancelScheduled !== 'function' || typeof onDeadline !== 'function') {
      throw new TypeError('Attempt deadline dependencies are required.');
    }

    const delay = Math.max(0, finiteMilliseconds(delayMs, MAX_ATTEMPT_MS));
    let scheduledId = null;
    let completed = false;

    function cancel() {
      if (scheduledId === null) return false;
      cancelScheduled(scheduledId);
      scheduledId = null;
      return true;
    }

    function expire() {
      if (completed) return false;
      completed = true;
      scheduledId = null;
      onDeadline();
      return true;
    }

    function start() {
      if (completed || scheduledId !== null) return false;
      scheduledId = schedule(expire, delay);
      return true;
    }

    return Object.freeze({
      start,
      cancel,
      expire,
      isCompleted: () => completed,
    });
  }

  globalThis.Minuto106AttemptTiming = Object.freeze({
    MIN_MANUAL_STOP_MS,
    MAX_ATTEMPT_MS,
    canSubmitManualStop,
    createAutomaticFinishSignal,
    createDeadline,
  });
})();
