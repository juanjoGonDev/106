(() => {
  const MOBILE_HOME_MEDIA = '(max-width: 700px)';

  function placeAwards(isMobile) {
    const awards = document.querySelector('#awardsCard');
    const battle = document.querySelector('.battle-card');
    if (!awards || !battle) return;

    if (isMobile) {
      if (battle.nextElementSibling !== awards) battle.after(awards);
      return;
    }

    const rightRail = document.querySelector('.layout-rail--right');
    if (!rightRail) return;
    if (awards.parentElement !== rightRail || rightRail.firstElementChild !== awards) rightRail.prepend(awards);
  }

  function initialize() {
    const media = window.matchMedia(MOBILE_HOME_MEDIA);
    const updateAwardsPlacement = () => placeAwards(media.matches);
    updateAwardsPlacement();
    media.addEventListener('change', updateAwardsPlacement);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();