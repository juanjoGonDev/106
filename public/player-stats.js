(() => {
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  const AXES = [
    ['Precisión', 'precision'],
    ['Regularidad', 'consistency'],
    ['Experiencia', 'experience'],
    ['Fiabilidad', 'reliability'],
    ['Impacto', 'impact'],
  ];

  const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const inverseScore = (value, maximum) => {
    if (!Number.isFinite(Number(value))) return 0;
    return clamp(100 - (Number(value) / maximum) * 100);
  };

  function buildRadarStats(profile = {}) {
    const attemptsUsed = Math.max(0, Number(profile.attemptsUsed) || 0);
    const verifiedAttempts = Math.max(0, Number(profile.verifiedAttempts) || 0);
    const completedReferrals = Math.max(0, Number(profile.completedReferrals) || 0);
    const bonusAttempts = Math.max(0, Number(profile.bonusAttempts) || 0);
    return {
      precision: inverseScore(profile.bestDifferenceMs, 1000),
      consistency: inverseScore(profile.averageDifferenceMs, 1500),
      experience: clamp((verifiedAttempts / 20) * 100),
      reliability: attemptsUsed > 0 ? clamp((verifiedAttempts / attemptsUsed) * 100) : 0,
      impact: clamp(completedReferrals * 20 + bonusAttempts * 8),
    };
  }

  function point(index, radius, center = 170) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / AXES.length;
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  }

  function polygonPoints(values, radius = 112, center = 170) {
    return AXES.map(([, key], index) => {
      const valueRadius = radius * (clamp(values[key]) / 100);
      const coordinates = point(index, valueRadius, center);
      return `${coordinates.x.toFixed(2)},${coordinates.y.toFixed(2)}`;
    }).join(' ');
  }

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NAMESPACE, name);
    for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, String(value));
    return element;
  }

  function appendGrid(svg) {
    const center = 170;
    const radius = 112;
    for (const level of [20, 40, 60, 80, 100]) {
      const values = Object.fromEntries(AXES.map(([, key]) => [key, level]));
      svg.append(createSvgElement('polygon', { points: polygonPoints(values, radius, center), class: 'radar-grid' }));
    }
    AXES.forEach(([, key], index) => {
      const end = point(index, radius, center);
      svg.append(createSvgElement('line', { x1: center, y1: center, x2: end.x, y2: end.y, class: 'radar-axis', 'data-axis': key }));
    });
    AXES.forEach(([label], index) => {
      const position = point(index, radius + 30, center);
      const text = createSvgElement('text', { x: position.x, y: position.y + 4, class: 'radar-label' });
      text.textContent = label;
      svg.append(text);
    });
  }

  function appendSeries(svg, profile, className) {
    const stats = buildRadarStats(profile);
    svg.append(createSvgElement('polygon', { points: polygonPoints(stats), class: className }));
    AXES.forEach(([, key], index) => {
      const coordinates = point(index, 112 * (stats[key] / 100));
      svg.append(createSvgElement('circle', {
        cx: coordinates.x,
        cy: coordinates.y,
        r: 4,
        class: `${className} radar-point`,
      }));
    });
  }

  function renderPlayerRadar(target, profiles) {
    if (!target) return;
    const series = Array.isArray(profiles) ? profiles.filter((item) => item?.profile).slice(0, 2) : [];
    target.replaceChildren();
    const svg = createSvgElement('svg', {
      viewBox: '0 0 340 340',
      role: 'img',
      'aria-label': 'Comparación pentagonal de estadísticas de jugadores',
    });
    appendGrid(svg);
    series.forEach((item, index) => appendSeries(svg, item.profile, index === 0 ? 'radar-shape-a' : 'radar-shape-b'));
    const legend = document.createElement('div');
    legend.className = 'radar-legend';
    series.forEach((item) => {
      const entry = document.createElement('span');
      const marker = document.createElement('i');
      const label = document.createTextNode(String(item.label || item.profile.nick || 'Jugador'));
      entry.append(marker, label);
      legend.append(entry);
    });
    target.append(svg, legend);
  }

  window.Minuto106PlayerStats = {
    axes: AXES.map(([label, key]) => ({ label, key })),
    buildRadarStats,
    renderPlayerRadar,
  };
})();