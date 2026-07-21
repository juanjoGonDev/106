(() => {
  const shell = document.querySelector('main.shell');
  if (!shell || shell.querySelector(':scope > .app-layout')) return;

  const layout = document.createElement('div');
  layout.className = 'app-layout';

  const leftRail = document.createElement('aside');
  leftRail.className = 'layout-rail layout-rail--left';
  leftRail.setAttribute('aria-label', 'Clasificación');

  const centerColumn = document.createElement('div');
  centerColumn.className = 'layout-center';

  const rightRail = document.createElement('aside');
  rightRail.className = 'layout-rail layout-rail--right';
  rightRail.setAttribute('aria-label', 'Premios y competición');

  const move = (selector, destination) => {
    const element = shell.querySelector(`:scope > ${selector}`);
    if (element) destination.append(element);
  };

  move('.leaderboard-card', leftRail);

  for (const selector of [
    '.game-hero',
    '.how-to-play',
    '#configWarning',
    '.battle-card',
    '.stats-strip',
    '.game-card',
    '#profileCard',
  ]) {
    move(selector, centerColumn);
  }

  move('#awardsCard', rightRail);
  move('#competitiveHub', rightRail);

  layout.append(leftRail, centerColumn, rightRail);
  shell.append(layout);
})();
