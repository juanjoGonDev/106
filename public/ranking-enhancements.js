(() => {
  const ui = window.Minuto106PlayerUI;
  const homeStats = window.Minuto106HomeStats;
  if (!ui || !homeStats) return;

  function resolveAward(award, suffix) {
    if (!award?.nick) return Object.freeze({ empty: true });
    const team = ui.resolveTeam(award.team);
    const formatter = window.Minuto106Format;
    return Object.freeze({
      empty: false,
      nick: String(award.nick),
      team,
      value: formatter?.fullNumber(award.value) ?? String(Number(award.value || 0)),
      suffix,
    });
  }

  function awardHtml(view) {
    if (view.empty) return 'Aún sin dueño';
    const flag = view.team
      ? `<span class="flag award-flag ${view.team.flagClass}" role="img" aria-label="${ui.escapeHtml(view.team.name)}"></span>`
      : '<span class="player-team--unknown">Selección no disponible</span>';
    return `<a class="award-player-link" href="${ui.escapeHtml(ui.playerUrl(view.nick))}" data-player-nick="${ui.escapeHtml(view.nick)}">${flag}<span>${ui.escapeHtml(view.nick)}</span><span>· ${view.value}${view.suffix}</span></a>`;
  }

  function renderAwards(stats) {
    if (!stats || !Object.hasOwn(stats, 'awards')) return;
    const awards = stats.awards || {};
    const views = [
      resolveAward(awards.goldenBoot, ' ms'),
      resolveAward(awards.goldenGlove, ' ms'),
      resolveAward(awards.goldenBall, ' intentos'),
    ];
    const selectors = ['#goldenBoot', '#goldenGlove', '#goldenBall'];
    for (let index = 0; index < selectors.length; index += 1) {
      const target = document.querySelector(selectors[index]);
      if (target) target.innerHTML = awardHtml(views[index]);
    }
  }

  homeStats.subscribe(renderAwards);
})();
