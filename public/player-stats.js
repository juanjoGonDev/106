(() => {
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  const radarModel = window.Minuto106PlayerRadarModel;
  if (!radarModel) throw new Error('Minuto106PlayerRadarModel must load before player-stats.js.');

  const RADAR_POLICY = radarModel.policy;
  const buildRadarStats = radarModel.buildRadarStats;
  const resolveLifetimeAttemptsUsed = radarModel.resolveLifetimeAttemptsUsed;
  const AXES = [
    ['Precisión', 'precision'],
    ['Regularidad', 'consistency'],
    ['Experiencia', 'experience'],
    ['Fiabilidad', 'reliability'],
    ['Impacto', 'impact'],
  ];

  const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const nonNegativeInteger = (value) => Math.max(0, Math.trunc(Number(value) || 0));
  const formatInteger = (value) => nonNegativeInteger(value).toLocaleString('es-ES');
  const formatDifference = (value) => {
    if (!Number.isFinite(Number(value))) return 'sin datos';
    return `±${Math.round(Math.abs(Number(value))).toLocaleString('es-ES')} ms`;
  };

  function statExplanations(profile = {}) {
    const stats = buildRadarStats(profile);
    const lifetimeAttemptsUsed = resolveLifetimeAttemptsUsed(profile);
    const verifiedAttempts = nonNegativeInteger(profile.verifiedAttempts);
    const completedReferrals = nonNegativeInteger(profile.completedReferrals);
    const bonusAttempts = nonNegativeInteger(profile.bonusAttempts);
    const referralLabel = completedReferrals === 1 ? 'referido completado' : 'referidos completados';
    const attemptLabel = bonusAttempts === 1 ? 'intento diario adicional' : 'intentos diarios adicionales';
    const reliabilityCurrent = lifetimeAttemptsUsed > 0
      ? `${formatInteger(verifiedAttempts)} intentos válidos de ${formatInteger(lifetimeAttemptsUsed)} intentos históricos.`
      : 'Aún no hay intentos históricos para calcular el porcentaje.';

    return Object.freeze([
      Object.freeze({
        key: 'precision',
        label: 'Precisión',
        score: stats.precision,
        current: `Tu mejor diferencia actual es ${formatDifference(profile.bestDifferenceMs)}.`,
        measure: 'Mide lo cerca que ha quedado tu mejor intento global de los 106 segundos exactos.',
        calculation: `Parte de 100/100 con 0 ms de diferencia y baja de forma lineal hasta 0/100 con ${RADAR_POLICY.precisionMaximumDifferenceMs.toLocaleString('es-ES')} ms o más.`,
        improve: 'Registra una marca válida más próxima a 106 segundos. Solo mejora cuando superas tu mejor diferencia.',
      }),
      Object.freeze({
        key: 'consistency',
        label: 'Regularidad',
        score: stats.consistency,
        current: `Tu media global actual es ${formatDifference(profile.averageDifferenceMs)}.`,
        measure: 'Mide cuánto se mantiene cerca de 106 segundos el conjunto de tus resultados globales.',
        calculation: `Parte de 100/100 con una media de 0 ms y baja de forma lineal hasta 0/100 con ${RADAR_POLICY.consistencyMaximumDifferenceMs.toLocaleString('es-ES')} ms o más.`,
        improve: 'Encadena resultados válidos próximos a 106 segundos para reducir tu diferencia media.',
      }),
      Object.freeze({
        key: 'experience',
        label: 'Experiencia',
        score: stats.experience,
        current: `Tienes ${formatInteger(verifiedAttempts)} intentos válidos.`,
        measure: 'Representa la cantidad de intentos válidos que has completado.',
        calculation: `Cada intento válido aporta 5 puntos. Alcanzas 100/100 con ${RADAR_POLICY.experienceMaximumVerifiedAttempts} intentos válidos.`,
        improve: 'Completa más intentos globales válidos; los intentos excluidos no suman experiencia.',
      }),
      Object.freeze({
        key: 'reliability',
        label: 'Fiabilidad',
        score: stats.reliability,
        current: reliabilityCurrent,
        measure: 'Mide qué proporción de tus intentos globales históricos termina siendo válida.',
        calculation: 'Divide los intentos válidos entre todos tus intentos globales históricos y redondea el porcentaje a una puntuación sobre 100.',
        improve: 'Evita intentos excluidos o inválidos. El reinicio diario no borra el historial usado por esta estadística.',
      }),
      Object.freeze({
        key: 'impact',
        label: 'Impacto',
        score: stats.impact,
        current: `${formatInteger(completedReferrals)} ${referralLabel} y +${formatInteger(bonusAttempts)} ${attemptLabel}.`,
        measure: 'Mide tu contribución al crecimiento de la comunidad y a la ampliación del límite diario.',
        calculation: `Cada referido completado suma ${RADAR_POLICY.impactPointsPerReferral} puntos y cada intento diario adicional suma ${RADAR_POLICY.impactPointsPerBonusAttempt}, con un máximo de 100/100.`,
        improve: 'Consigue referidos completados o nuevos intentos diarios adicionales. Las partidas, los trofeos y los logros no lo aumentan directamente.',
      }),
    ]);
  }

  function impactExplanation(profile = {}) {
    const completedReferrals = nonNegativeInteger(profile.completedReferrals);
    const bonusAttempts = nonNegativeInteger(profile.bonusAttempts);
    const impact = buildRadarStats(profile).impact;
    const referralLabel = completedReferrals === 1 ? 'referido completado' : 'referidos completados';
    const attemptLabel = bonusAttempts === 1 ? 'intento diario adicional' : 'intentos diarios adicionales';
    return Object.freeze({
      impact,
      completedReferrals,
      bonusAttempts,
      copy: `Impacto ${impact}/100 · ${completedReferrals} ${referralLabel} · +${bonusAttempts} ${attemptLabel}. Cada referido completado suma ${RADAR_POLICY.impactPointsPerReferral} puntos y cada intento diario adicional suma ${RADAR_POLICY.impactPointsPerBonusAttempt}.`,
    });
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

  function appendExplanation(target, explanation) {
    const details = document.createElement('details');
    details.className = 'player-radar-stat';
    details.dataset.statKey = explanation.key;

    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', `${explanation.label}: ${explanation.score} sobre 100. Ver explicación.`);
    const heading = document.createElement('span');
    heading.className = 'player-radar-stat__heading';
    const label = document.createElement('strong');
    label.textContent = explanation.label;
    const hint = document.createElement('small');
    hint.textContent = explanation.current;
    heading.append(label, hint);
    const score = document.createElement('span');
    score.className = 'player-radar-stat__score';
    score.textContent = `${explanation.score}/100`;
    summary.append(heading, score);

    const content = document.createElement('div');
    content.className = 'player-radar-stat__content';
    for (const [labelText, copy] of [
      ['Qué mide', explanation.measure],
      ['Cómo se calcula', explanation.calculation],
      ['Cómo mejorar', explanation.improve],
    ]) {
      const paragraph = document.createElement('p');
      const title = document.createElement('strong');
      title.textContent = `${labelText}: `;
      paragraph.append(title, document.createTextNode(copy));
      content.append(paragraph);
    }

    details.append(summary, content);
    target.append(details);
  }

  function renderStatExplanations(target, profile) {
    if (!target) return;
    target.replaceChildren();
    statExplanations(profile).forEach((explanation) => appendExplanation(target, explanation));
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

    renderStatExplanations(document.querySelector('#playerRadarExplanations'), series[0]?.profile ?? {});
  }

  window.Minuto106PlayerStats = {
    axes: AXES.map(([label, key]) => ({ label, key })),
    buildRadarStats,
    impactExplanation,
    policy: RADAR_POLICY,
    renderPlayerRadar,
    renderStatExplanations,
    resolveLifetimeAttemptsUsed,
    statExplanations,
  };
})();
