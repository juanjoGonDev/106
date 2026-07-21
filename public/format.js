(() => {
  function compactNumber(input) {
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) return '0';

    const sign = numeric < 0 ? '-' : '';
    let value = Math.abs(numeric);
    const units = ['', 'k', 'M', 'B', 'T'];
    let unitIndex = 0;

    while (value >= 1000 && unitIndex < units.length - 1) {
      value /= 1000;
      unitIndex += 1;
    }

    if (unitIndex === 0) return `${sign}${Math.round(value).toLocaleString('es-ES')}`;

    const decimals = value < 100 && !Number.isInteger(value) ? 1 : 0;
    let rounded = Number(value.toFixed(decimals));
    if (rounded >= 1000 && unitIndex < units.length - 1) {
      rounded /= 1000;
      unitIndex += 1;
    }

    return `${sign}${Number(rounded.toFixed(rounded < 100 && !Number.isInteger(rounded) ? 1 : 0))}${units[unitIndex]}`;
  }

  function fullNumber(input) {
    const numeric = Number(input);
    return Number.isFinite(numeric) ? Math.round(numeric).toLocaleString('es-ES') : '0';
  }

  window.Minuto106Format = Object.freeze({ compactNumber, fullNumber });
})();
