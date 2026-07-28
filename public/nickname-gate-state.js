(() => {
  function remoteNicknameReason(availability) {
    const value = String(availability ?? '');
    return value.startsWith('invalid-') ? value.slice('invalid-'.length) : null;
  }

  function resolveNicknameGate({ validation, remoteAvailability = 'unknown', remotePending = false }) {
    const localReason = validation?.valid === true ? null : String(validation?.reason ?? 'invalid');
    const remoteReason = remoteNicknameReason(remoteAvailability);
    const ready = localReason === null
      && remoteReason === null
      && remotePending !== true
      && ['available', 'owned'].includes(String(remoteAvailability));

    return Object.freeze({
      ready,
      reason: localReason ?? remoteReason,
      captchaAllowed: ready,
      startAllowed: ready,
    });
  }

  globalThis.Minuto106NicknameGateState = Object.freeze({
    remoteNicknameReason,
    resolveNicknameGate,
  });
})();
