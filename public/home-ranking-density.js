(() => {
  const MOBILE_HOME_MEDIA = '(max-width: 700px)';
  const TEAMS = Object.freeze({
    spain: Object.freeze({ name: 'España', asset: './assets/flag-spain.svg', flagClass: 'flag--spain' }),
    argentina: Object.freeze({ name: 'Argentina', asset: './assets/flag-argentina.svg', flagClass: 'flag--argentina' }),
  });

  function resolveTeam(row) {
    const declared = String(row.dataset.team ?? '');
    if (Object.hasOwn(TEAMS, declared)) return declared;
    if (row.querySelector('.flag--spain')) return 'spain';
    if (row.querySelector('.flag--argentina')) return 'argentina';
    return '';
  }

  function extractNick(anchor, player) {
    const declared = String(anchor.dataset.playerNick ?? '').trim();
    if (declared) return declared;
    const explicit = player.querySelector('.player-link__nick')?.textContent?.trim();
    if (explicit) return explicit;
    return Array.from(player.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE)
      ?.textContent?.trim() ?? '';
  }

  function removeWhitespace(value) {
    return Array.from(String(value)).filter((character) => ![' ', '\n', '\r', '\t'].includes(character)).join('');
  }

  function normalizeTime(value) {
    const compact = removeWhitespace(value).toLocaleLowerCase('es').replace(',', '.');
    const match = compact.match(/^(\d+(?:\.\d+)?)s$/u);
    if (!match) return '';
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) ? `${seconds.toFixed(3)}s` : '';
  }

  function extractTime(player) {
    const explicit = normalizeTime(player.querySelector('.ranking-time')?.textContent ?? '');
    if (explicit) return explicit;

    const source = String(player.querySelector('small')?.textContent ?? player.textContent ?? '')
      .replaceAll('·', ' ')
      .replaceAll('\n', ' ')
      .replaceAll('\r', ' ')
      .replaceAll('\t', ' ');
    const match = source.match(/(\d+(?:[.,]\d+)?)\s*s(?:\b|$)/iu);
    return normalizeTime(match ? `${match[1]}s` : '');
  }

  function hasNumericValue(value) {
    return Array.from(String(value)).some((character) => character >= '0' && character <= '9');
  }

  function createFlag(teamKey) {
    const team = TEAMS[teamKey];
    const image = document.createElement('img');
    image.className = `flag ranking-flag ${team.flagClass}`;
    image.src = new URL(team.asset, document.baseURI).toString();
    image.alt = team.name;
    image.width = 20;
    image.height = 14;
    image.decoding = 'async';
    return image;
  }

  function createIdentity(teamKey, nick) {
    const identity = document.createElement('span');
    identity.className = 'ranking-player__identity';

    const nickElement = document.createElement('span');
    nickElement.className = 'player-link__nick';
    nickElement.textContent = nick;

    identity.append(createFlag(teamKey), nickElement);
    return identity;
  }

  function readRow(row) {
    const anchor = row.querySelector(':scope > .leaderboard-row-link');
    if (!anchor) return null;
    const player = anchor.querySelector('.player, .ranking-player');
    const teamKey = resolveTeam(row);
    if (!player || !teamKey) return null;

    const nick = extractNick(anchor, player);
    const time = extractTime(player);
    const rank = anchor.querySelector('.rank')?.textContent?.trim() ?? '';
    const difference = anchor.querySelector('.difference')?.textContent?.trim() ?? '';
    if (!nick || !time || !hasNumericValue(rank) || !hasNumericValue(difference)) return null;

    return {
      row,
      player,
      teamKey,
      nick,
      time,
      ready: row.dataset.homeRankingReady === 'true',
    };
  }

  function compactRow(rowData) {
    if (rowData.ready) return;
    const identity = createIdentity(rowData.teamKey, rowData.nick);
    const timeElement = document.createElement('small');
    timeElement.className = 'ranking-time';
    timeElement.textContent = rowData.time;

    rowData.player.className = 'player ranking-player ranking-player--home';
    rowData.player.replaceChildren(identity, timeElement);
    rowData.row.dataset.team = rowData.teamKey;
    rowData.row.dataset.homeRankingReady = 'true';
  }

  function compactLeaderboard(list) {
    const rows = Array.from(list.querySelectorAll(':scope > li:not(.empty)'));
    if (!rows.length) {
      list.removeAttribute('aria-busy');
      list.dataset.renderState = 'empty';
      return true;
    }

    list.setAttribute('aria-busy', 'true');
    list.dataset.renderState = 'waiting';
    const rowData = rows.map(readRow);
    if (rowData.some((entry) => entry === null)) return false;

    for (const entry of rowData) compactRow(entry);
    list.removeAttribute('aria-busy');
    list.dataset.renderState = 'ready';
    return true;
  }

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
    const list = document.querySelector('#leaderboard');
    if (list) {
      const observer = new MutationObserver(() => compactLeaderboard(list));
      observer.observe(list, { childList: true, subtree: true, characterData: true });
      compactLeaderboard(list);
    }

    const media = window.matchMedia(MOBILE_HOME_MEDIA);
    const updateAwardsPlacement = () => placeAwards(media.matches);
    updateAwardsPlacement();
    media.addEventListener('change', updateAwardsPlacement);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();