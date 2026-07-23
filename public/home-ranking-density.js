(() => {
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

  function extractTime(player) {
    const explicit = player.querySelector('.ranking-time')?.textContent?.trim();
    if (explicit) return removeWhitespace(explicit);
    const source = String(player.querySelector('small')?.textContent ?? player.textContent ?? '')
      .replaceAll('·', ' ')
      .replaceAll('\n', ' ')
      .replaceAll('\r', ' ')
      .replaceAll('\t', ' ');
    const tokens = source.split(' ').map((token) => token.trim()).filter(Boolean);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const next = tokens[index + 1]?.toLocaleLowerCase('es');
      if (next === 's' && Number.isFinite(Number(token.replace(',', '.')))) return `${token}s`;
      if (token.toLocaleLowerCase('es').endsWith('s')) {
        const numeric = token.slice(0, -1).replace(',', '.');
        if (Number.isFinite(Number(numeric))) return removeWhitespace(token);
      }
    }
    return '—';
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

  function compactRow(row) {
    const anchor = row.querySelector(':scope > .leaderboard-row-link');
    if (!anchor) return;
    const player = anchor.querySelector('.player, .ranking-player');
    const teamKey = resolveTeam(row);
    if (!player || !teamKey) return;

    const nick = extractNick(anchor, player);
    if (!nick) return;
    const time = extractTime(player);

    const nickElement = document.createElement('span');
    nickElement.className = 'player-link__nick';
    nickElement.textContent = nick;

    const timeElement = document.createElement('small');
    timeElement.className = 'ranking-time';
    timeElement.textContent = time;

    player.className = 'player ranking-player ranking-player--compact';
    player.replaceChildren(nickElement, createFlag(teamKey), timeElement);
    row.dataset.team = teamKey;
  }

  function compactLeaderboard(list) {
    for (const row of list.querySelectorAll(':scope > li:not(.empty)')) compactRow(row);
  }

  function initialize() {
    const list = document.querySelector('#leaderboard');
    if (!list) return;
    compactLeaderboard(list);
    new MutationObserver(() => compactLeaderboard(list)).observe(list, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
