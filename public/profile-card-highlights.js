(() => {
  const playerUi = window.Minuto106PlayerUI;
  if (!playerUi?.cardUrl) return;

  window.Minuto106PlayerUI = Object.freeze({
    ...playerUi,
    cardUrl(apiBaseUrl, nick, section = 'overview', revision = 0) {
      const cardSection = section === 'overview' ? 'achievements' : section;
      return playerUi.cardUrl(apiBaseUrl, nick, cardSection, revision);
    },
  });
})();
