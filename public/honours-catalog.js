(() => {
  const MAX_FEATURED = 3;
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value) => Math.max(0, Math.min(100, Math.round(number(value))));

  const definitions = [
    { code: 'first_trophy', group: 'trophies', order: 1, title: 'Primer trofeo', description: 'Consigue tu primer trofeo diario.', metric: 'totalTrophies', target: 1 },
    { code: 'trophy_total_3', group: 'trophies', order: 2, title: 'Tres trofeos', description: 'Acumula tres trofeos diarios.', metric: 'totalTrophies', target: 3 },
    { code: 'trophy_total_10', group: 'trophies', order: 3, title: 'Palmarés de diez', description: 'Acumula diez trofeos diarios.', metric: 'totalTrophies', target: 10 },
    { code: 'category_total_golden_boot_3', group: 'trophies', order: 4, title: 'Especialista en Bota', description: 'Gana tres Botas de Oro.', metric: 'goldenBoot', target: 3 },
    { code: 'category_total_golden_glove_3', group: 'trophies', order: 5, title: 'Especialista en Guante', description: 'Gana tres Guantes de Oro.', metric: 'goldenGlove', target: 3 },
    { code: 'category_total_golden_ball_3', group: 'trophies', order: 6, title: 'Especialista en Balón', description: 'Gana tres Balones de Oro.', metric: 'goldenBall', target: 3 },
    { code: 'trophy_streak_2', group: 'trophies', order: 7, title: 'Dos días seguidos', description: 'Consigue trofeos en dos días consecutivos.', metric: 'longestTrophyStreak', target: 2 },
    { code: 'trophy_streak_3', group: 'trophies', order: 8, title: 'Racha de tres', description: 'Consigue trofeos en tres días consecutivos.', metric: 'longestTrophyStreak', target: 3 },
    { code: 'trophy_streak_7', group: 'trophies', order: 9, title: 'Semana perfecta', description: 'Consigue trofeos durante siete días consecutivos.', metric: 'longestTrophyStreak', target: 7 },
    { code: 'complete_set', group: 'trophies', order: 10, title: 'Colección completa', description: 'Consigue al menos una Bota, un Guante y un Balón de Oro.', metric: 'trophyCategoryCount', target: 3, unit: 'categorías' },
    { code: 'daily_hat_trick', matchKind: 'daily_hat_trick', group: 'trophies', order: 11, title: 'Triplete diario', description: 'Gana las tres categorías en el mismo día.', metric: 'maxDailyTrophyCategories', target: 3, unit: 'categorías en un día' },
    { code: 'first_of_month', matchKind: 'first_of_month', group: 'trophies', order: 12, title: 'Primero del mes', description: 'Sé el primer ganador mensual de una categoría.', metric: 'monthlyFirst', target: 1, nonLinear: true },

    { code: 'perfect_total_1', group: 'precision', order: 1, title: 'Primer latido perfecto', description: 'Clava exactamente 10.600 en un intento verificado.', metric: 'perfectAttempts', target: 1, points: 15 },
    { code: 'perfect_total_3', group: 'precision', order: 2, title: 'El reloj te reconoce', description: 'Acumula tres tiempos perfectos.', metric: 'perfectAttempts', target: 3, points: 25 },
    { code: 'perfect_total_5', group: 'precision', order: 3, title: 'Precisión repetible', description: 'Acumula cinco tiempos perfectos.', metric: 'perfectAttempts', target: 5, points: 40 },
    { code: 'perfect_total_10', group: 'precision', order: 4, title: 'Reloj dominado', description: 'Acumula diez tiempos perfectos.', metric: 'perfectAttempts', target: 10, points: 75 },
    { code: 'perfect_total_25', group: 'precision', order: 5, title: 'Dueño del segundo', description: 'Acumula veinticinco tiempos perfectos.', metric: 'perfectAttempts', target: 25, points: 140 },
    { code: 'perfect_total_50', group: 'precision', order: 6, title: 'Cronómetro rendido', description: 'Acumula cincuenta tiempos perfectos.', metric: 'perfectAttempts', target: 50, points: 240 },
    { code: 'perfect_total_100', group: 'precision', order: 7, title: 'Cien veces perfecto', description: 'Acumula cien tiempos perfectos.', metric: 'perfectAttempts', target: 100, points: 400 },
    { code: 'perfect_average', group: 'precision', order: 8, title: 'Media imposible', description: 'Mantén una media exacta de 0 ms tras al menos tres intentos verificados.', metric: 'perfectAverage', target: 3, points: 120 },
    { code: 'precision_1000', group: 'precision', order: 9, title: 'Dentro del segundo', description: 'Registra una marca global a un segundo o menos.', metric: 'bestDifferenceMs', target: 1000, direction: 'lower', unit: 'ms', points: 5 },
    { code: 'precision_250', group: 'precision', order: 10, title: 'Zona de precisión', description: 'Registra una marca global a 250 ms o menos.', metric: 'bestDifferenceMs', target: 250, direction: 'lower', unit: 'ms', points: 10 },
    { code: 'precision_100', group: 'precision', order: 11, title: 'Pulso de élite', description: 'Registra una marca global a 100 ms o menos.', metric: 'bestDifferenceMs', target: 100, direction: 'lower', unit: 'ms', points: 20 },
    { code: 'precision_50', group: 'precision', order: 12, title: 'Rozando el instante', description: 'Registra una marca global a 50 ms o menos.', metric: 'bestDifferenceMs', target: 50, direction: 'lower', unit: 'ms', points: 35 },
    { code: 'precision_10', group: 'precision', order: 13, title: 'Margen histórico', description: 'Registra una marca global a 10 ms o menos.', metric: 'bestDifferenceMs', target: 10, direction: 'lower', unit: 'ms', points: 65 },

    { code: 'verified_total_5', group: 'activity', order: 1, title: 'Primera tanda completa', description: 'Completa cinco intentos verificados.', metric: 'verifiedAttempts', target: 5, points: 10 },
    { code: 'verified_total_10', group: 'activity', order: 2, title: 'Doble prórroga', description: 'Completa diez intentos verificados.', metric: 'verifiedAttempts', target: 10, points: 18 },
    { code: 'verified_total_25', group: 'activity', order: 3, title: 'Rodaje competitivo', description: 'Completa veinticinco intentos verificados.', metric: 'verifiedAttempts', target: 25, points: 35 },
    { code: 'verified_total_50', group: 'activity', order: 4, title: 'Veterano del 106', description: 'Completa cincuenta intentos verificados.', metric: 'verifiedAttempts', target: 50, points: 60 },
    { code: 'verified_total_100', group: 'activity', order: 5, title: 'Centenario', description: 'Completa cien intentos verificados.', metric: 'verifiedAttempts', target: 100, points: 110 },
    { code: 'verified_total_250', group: 'activity', order: 6, title: 'Ritmo profesional', description: 'Completa doscientos cincuenta intentos verificados.', metric: 'verifiedAttempts', target: 250, points: 220 },
    { code: 'verified_total_500', group: 'activity', order: 7, title: 'Leyenda persistente', description: 'Completa quinientos intentos verificados.', metric: 'verifiedAttempts', target: 500, points: 380 },

    { code: 'referral_total_1', group: 'community', order: 1, title: 'Primer fichaje', description: 'Consigue que un invitado complete su tanda global.', metric: 'completedReferrals', target: 1, points: 15 },
    { code: 'referral_total_3', group: 'community', order: 2, title: 'Convocatoria completa', description: 'Consigue tres invitaciones completadas.', metric: 'completedReferrals', target: 3, points: 30 },
    { code: 'referral_total_10', group: 'community', order: 3, title: 'Vestuario lleno', description: 'Consigue diez invitaciones completadas.', metric: 'completedReferrals', target: 10, points: 70 },
    { code: 'referral_total_25', group: 'community', order: 4, title: 'Capitán de comunidad', description: 'Consigue veinticinco invitaciones completadas.', metric: 'completedReferrals', target: 25, points: 140 },
    { code: 'referral_total_50', group: 'community', order: 5, title: 'Estadio lleno', description: 'Consigue cincuenta invitaciones completadas.', metric: 'completedReferrals', target: 50, points: 260 },

    { code: 'duel_created_1', group: 'duels', order: 1, title: 'Guante lanzado', description: 'Crea tu primer reto directo.', metric: 'duelsCreated', target: 1, points: 8 },
    { code: 'duel_created_5', group: 'duels', order: 2, title: 'Retador habitual', description: 'Crea cinco retos directos.', metric: 'duelsCreated', target: 5, points: 20 },
    { code: 'duel_created_10', group: 'duels', order: 3, title: 'Sin miedo al reloj', description: 'Crea diez retos directos.', metric: 'duelsCreated', target: 10, points: 35 },
    { code: 'duel_created_50', group: 'duels', order: 4, title: 'Maestro del desafío', description: 'Crea cincuenta retos directos.', metric: 'duelsCreated', target: 50, points: 100 },
    { code: 'duel_created_100', group: 'duels', order: 5, title: 'Cien retos abiertos', description: 'Crea cien retos directos.', metric: 'duelsCreated', target: 100, points: 180 },
    { code: 'duel_wins_1', group: 'duels', order: 6, title: 'Primer duelo ganado', description: 'Gana tu primer reto directo resuelto.', metric: 'duelsWon', target: 1, points: 20 },
    { code: 'duel_wins_5', group: 'duels', order: 7, title: 'Cinco rivales atrás', description: 'Gana cinco retos directos.', metric: 'duelsWon', target: 5, points: 55 },
    { code: 'duel_wins_10', group: 'duels', order: 8, title: 'Invicto en la prórroga', description: 'Gana diez retos directos.', metric: 'duelsWon', target: 10, points: 100 },
    { code: 'duel_wins_50', group: 'duels', order: 9, title: 'Dominador de duelos', description: 'Gana cincuenta retos directos.', metric: 'duelsWon', target: 50, points: 260 },
    { code: 'duel_wins_100', group: 'duels', order: 10, title: 'Leyenda del cara a cara', description: 'Gana cien retos directos.', metric: 'duelsWon', target: 100, points: 450 },

    { code: 'league_participation_1', group: 'leagues', order: 1, title: 'Debut en liga', description: 'Compite con una marca verificada en una liga elegible finalizada.', metric: 'completedLeagues', target: 1, points: 12 },
    { code: 'league_participation_5', group: 'leagues', order: 2, title: 'Jugador de liga', description: 'Compite en cinco ligas elegibles finalizadas.', metric: 'completedLeagues', target: 5, points: 35 },
    { code: 'league_participation_10', group: 'leagues', order: 3, title: 'Calendario completo', description: 'Compite en diez ligas elegibles finalizadas.', metric: 'completedLeagues', target: 10, points: 70 },
    { code: 'league_participation_25', group: 'leagues', order: 4, title: 'Trotamundos del 106', description: 'Compite en veinticinco ligas elegibles finalizadas.', metric: 'completedLeagues', target: 25, points: 160 },
    { code: 'league_podium', matchKind: 'league_podium', group: 'leagues', order: 5, title: 'Podio de liga', description: 'Termina entre los tres mejores de una liga elegible.', metric: 'leaguePodium', target: 1, nonLinear: true },
  ];

  function metricValue(profile, metric) {
    const progress = profile?.honoursProgress || {};
    const trophies = profile?.trophies || {};
    const values = {
      totalTrophies: trophies.total,
      goldenBoot: trophies.goldenBoot,
      goldenGlove: trophies.goldenGlove,
      goldenBall: trophies.goldenBall,
      longestTrophyStreak: progress.longestTrophyStreak,
      trophyCategoryCount: progress.trophyCategoryCount,
      maxDailyTrophyCategories: progress.maxDailyTrophyCategories,
      perfectAttempts: progress.perfectAttempts,
      verifiedAttempts: progress.verifiedAttempts ?? profile?.verifiedAttempts,
      completedReferrals: progress.completedReferrals ?? profile?.completedReferrals,
      duelsCreated: progress.duelsCreated,
      duelsWon: progress.duelsWon,
      completedLeagues: progress.completedLeagues,
      bestDifferenceMs: profile?.bestDifferenceMs,
    };
    return values[metric];
  }

  function countProgress(currentValue, target, unit = '') {
    const current = Math.max(0, number(currentValue));
    const goal = Math.max(1, number(target, 1));
    const remaining = Math.max(0, goal - current);
    const suffix = unit ? ` ${unit}` : '';
    return {
      current,
      target: goal,
      remaining,
      percent: clamp(current / goal * 100),
      label: remaining === 0
        ? `Completado: ${current.toLocaleString('es-ES')} de ${goal.toLocaleString('es-ES')}${suffix}.`
        : `${current.toLocaleString('es-ES')} de ${goal.toLocaleString('es-ES')}${suffix} · faltan ${remaining.toLocaleString('es-ES')}.`,
    };
  }

  function lowerProgress(currentValue, target, unit = '') {
    const current = Number.isFinite(Number(currentValue)) ? Number(currentValue) : null;
    const goal = Math.max(0, number(target));
    if (current === null) {
      return { current: null, target: goal, remaining: null, percent: 0, label: `Registra una marca válida de ${goal.toLocaleString('es-ES')} ${unit} o menos.` };
    }
    const remaining = Math.max(0, current - goal);
    const percent = current <= goal ? 100 : clamp(goal / Math.max(current, 1) * 100);
    return {
      current,
      target: goal,
      remaining,
      percent,
      label: remaining === 0
        ? `Completado con ±${current.toLocaleString('es-ES')} ${unit}.`
        : `Tu mejor marca es ±${current.toLocaleString('es-ES')} ${unit} · mejora ${remaining.toLocaleString('es-ES')} ${unit}.`,
    };
  }

  function perfectAverageProgress(profile) {
    const verified = number(profile?.honoursProgress?.verifiedAttempts ?? profile?.verifiedAttempts);
    const average = Number.isFinite(Number(profile?.averageDifferenceMs)) ? Number(profile.averageDifferenceMs) : null;
    if (verified < 3) return countProgress(verified, 3, 'intentos válidos');
    if (average === 0) return { current: 0, target: 0, remaining: 0, percent: 100, label: 'Completado: media exacta de 0 ms.' };
    return {
      current: average,
      target: 0,
      remaining: average,
      percent: 0,
      label: `Ya cumples el mínimo de intentos; reduce tu media actual de ±${number(average).toLocaleString('es-ES')} ms hasta 0 ms.`,
    };
  }

  function genericProgress(definition, profile) {
    if (definition.metric === 'perfectAverage') return perfectAverageProgress(profile);
    if (definition.nonLinear) {
      return {
        current: 0,
        target: 1,
        remaining: 1,
        percent: 0,
        label: definition.metric === 'monthlyFirst'
          ? 'Sé el primer ganador de una categoría en un nuevo mes.'
          : 'Termina entre los tres mejores de una liga elegible.',
      };
    }
    const value = metricValue(profile, definition.metric);
    return definition.direction === 'lower'
      ? lowerProgress(value, definition.target, definition.unit || 'ms')
      : countProgress(value, definition.target, definition.unit || '');
  }

  function buildAchievementCatalog(profile) {
    const items = Array.isArray(profile?.achievements?.items) ? profile.achievements.items : [];
    const featured = Array.isArray(profile?.achievements?.featured) ? profile.achievements.featured : [];
    const earnedByCode = new Map(items.map((item) => [String(item.code || ''), item]));
    const earnedByKind = new Map();
    for (const item of items) {
      const kind = String(item.kind || '');
      if (kind && !earnedByKind.has(kind)) earnedByKind.set(kind, item);
    }
    const featuredPosition = new Map(featured.map((item, index) => [String(item.code || ''), number(item.position, index + 1)]));
    const matchedCodes = new Set();
    const catalogue = [];

    for (const definition of definitions) {
      const earned = definition.matchKind
        ? earnedByKind.get(definition.matchKind)
        : earnedByCode.get(definition.code);
      if (earned?.code) matchedCodes.add(String(earned.code));
      const progress = earned
        ? { ...genericProgress(definition, profile), percent: 100, remaining: 0, label: 'Desbloqueado.' }
        : genericProgress(definition, profile);
      catalogue.push({
        code: String(earned?.code || definition.code),
        kind: String(earned?.kind || definition.matchKind || ''),
        title: String(earned?.title || definition.title),
        description: String(earned?.description || definition.description),
        points: earned?.points ?? definition.points ?? null,
        date: earned?.date || '',
        metadata: earned?.metadata || {},
        group: definition.group,
        order: definition.order,
        unlocked: Boolean(earned),
        featured: Boolean(earned?.code && featuredPosition.has(String(earned.code))),
        featuredPosition: earned?.code ? featuredPosition.get(String(earned.code)) ?? null : null,
        progress,
      });
    }

    for (const item of items) {
      const code = String(item.code || '');
      if (!code || matchedCodes.has(code)) continue;
      catalogue.push({
        code,
        kind: String(item.kind || ''),
        title: String(item.title || 'Logro'),
        description: String(item.description || ''),
        points: item.points ?? null,
        date: item.date || '',
        metadata: item.metadata || {},
        group: 'earned',
        order: 0,
        unlocked: true,
        featured: featuredPosition.has(code),
        featuredPosition: featuredPosition.get(code) ?? null,
        progress: { current: 1, target: 1, remaining: 0, percent: 100, label: 'Desbloqueado.' },
      });
    }

    return catalogue.sort((left, right) => {
      if (left.featured !== right.featured) return left.featured ? -1 : 1;
      if (left.featured && right.featured) return number(left.featuredPosition, 99) - number(right.featuredPosition, 99);
      if (left.unlocked !== right.unlocked) return left.unlocked ? -1 : 1;
      if (left.unlocked && right.unlocked) return String(right.date).localeCompare(String(left.date));
      const group = String(left.group).localeCompare(String(right.group));
      return group || number(left.order) - number(right.order);
    });
  }

  function trophyProgress(profile, type) {
    const today = profile?.honoursProgress?.today || {};
    const attempts = number(today.attempts);
    const best = Number.isFinite(Number(today.bestDifferenceMs)) ? Number(today.bestDifferenceMs) : null;
    const average = Number.isFinite(Number(today.averageDifferenceMs)) ? Number(today.averageDifferenceMs) : null;
    const state = today[type] || {};

    if (type === 'goldenBoot') {
      if (state.leading === true) return { percent: 100, label: `Lideras hoy con ±${number(best).toLocaleString('es-ES')} ms.` };
      if (best === null) return { percent: 0, label: 'Registra un intento global válido hoy.' };
      const target = Number.isFinite(Number(state.targetDifferenceMs)) ? Number(state.targetDifferenceMs) : best;
      const remaining = Math.max(1, best - target + 1);
      return { percent: clamp(target / Math.max(best, 1) * 100), label: `Mejora ${remaining.toLocaleString('es-ES')} ms para liderar hoy.` };
    }

    if (type === 'goldenGlove') {
      const required = number(state.requiredAttempts, 3);
      if (attempts < required) {
        const remaining = required - attempts;
        return { percent: clamp(attempts / required * 100), label: `Completa ${remaining} ${remaining === 1 ? 'intento válido más' : 'intentos válidos más'} para optar al Guante.` };
      }
      if (state.leading === true) return { percent: 100, label: `Lideras hoy con una media de ±${number(average).toLocaleString('es-ES')} ms.` };
      const target = Number.isFinite(Number(state.targetAverageDifferenceMs)) ? Number(state.targetAverageDifferenceMs) : average;
      const remaining = Math.max(1, number(average) - number(target) + 1);
      return { percent: clamp(number(target) / Math.max(number(average), 1) * 100), label: `Reduce tu media ${remaining.toLocaleString('es-ES')} ms para liderar hoy.` };
    }

    if (type === 'goldenBall') {
      const target = number(state.targetAttempts);
      if (state.leading === true) return { percent: 100, label: `Lideras hoy con ${attempts} ${attempts === 1 ? 'intento válido' : 'intentos válidos'}.` };
      if (attempts === 0) return { percent: 0, label: 'Completa intentos globales válidos hoy.' };
      if (attempts < target) {
        const remaining = target - attempts;
        return { percent: clamp(attempts / Math.max(target, 1) * 100), label: `Haz ${remaining} ${remaining === 1 ? 'intento más' : 'intentos más'} para igualar al líder; después manda la precisión.` };
      }
      return { percent: 90, label: 'Empatas en intentos: mejora tu mejor marca para romper el desempate.' };
    }

    return { percent: 0, label: 'Gana una miniliga elegible para sumar el siguiente campeonato.' };
  }

  function buildTrophyCatalog(profile) {
    const trophies = profile?.trophies || {};
    return [
      { type: 'golden_boot', progressKey: 'goldenBoot', title: 'Bota de Oro', description: 'Mejor marca global verificada del día.', count: number(trophies.goldenBoot) },
      { type: 'golden_glove', progressKey: 'goldenGlove', title: 'Guante de Oro', description: 'Mejor media diaria con al menos tres intentos válidos.', count: number(trophies.goldenGlove) },
      { type: 'golden_ball', progressKey: 'goldenBall', title: 'Balón de Oro', description: 'Mayor actividad diaria; los empates se resuelven por precisión.', count: number(trophies.goldenBall) },
      { type: 'league_champion', progressKey: 'leagueChampion', title: 'Campeón de liga', description: 'Primera posición en una miniliga elegible finalizada.', count: number(trophies.leagueChampion) },
    ].map((item) => ({
      ...item,
      unlocked: item.count > 0,
      progress: trophyProgress(profile, item.progressKey),
    }));
  }

  function normalizeFeaturedCodes(codes, unlockedCodes) {
    const allowed = new Set(Array.from(unlockedCodes || [], (code) => String(code)));
    const normalized = [];
    for (const value of Array.isArray(codes) ? codes : []) {
      const code = String(value || '');
      if (!code || !allowed.has(code) || normalized.includes(code)) continue;
      normalized.push(code);
      if (normalized.length === MAX_FEATURED) break;
    }
    return normalized;
  }

  window.Minuto106HonoursCatalog = Object.freeze({
    MAX_FEATURED,
    buildAchievementCatalog,
    buildTrophyCatalog,
    normalizeFeaturedCodes,
  });
})();
