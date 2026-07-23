import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isFrontendPath,
  parseVisualEvidence,
  validateVisualEvidence,
  VISUAL_EVIDENCE_MARKERS,
} from '../scripts/pr-visual-evidence.mjs';

function block(content) {
  return `${VISUAL_EVIDENCE_MARKERS.start}\n${content}\n${VISUAL_EVIDENCE_MARKERS.end}`;
}

function details(summary, image = 'https://github.com/user-attachments/assets/real-image') {
  const markdown = image === null ? 'No image' : `![${summary}](${image})`;
  return `<details><summary>${summary}</summary>\n\n${markdown}\n</details>`;
}

test('detects frontend paths across canonical directories and media extensions', () => {
  for (const path of [
    'index.html',
    'playwright.config.js',
    'public/app.js',
    'public\\v11.css',
    'supabase/functions/player-share/index.ts',
    'docs/mockup.webp',
    'docs/flow.GIF',
  ]) assert.equal(isFrontendPath(path), true, path);
  for (const path of ['', null, 'supabase/migrations/one.sql', 'scripts/server.mjs', 'README.md']) {
    assert.equal(isFrontendPath(path), false, String(path));
  }
});

test('parses only paired-device summaries inside the marker block', () => {
  const body = block([
    details('<strong>Player overview</strong> · Desktop', 'https://images.example/player-desktop.png'),
    details('Player overview - móvil', 'https://images.example/player-mobile.png "Mobile"'),
    details('Animation · GIF', 'https://images.example/animation.gif'),
    '<details><summary>Broken</summary>![x](https://images.example/x.png)</details>',
  ].join('\n'));
  assert.deepEqual(parseVisualEvidence(body), {
    hasMarkers: true,
    entries: [
      { area: 'Player overview', device: 'desktop', image: 'https://images.example/player-desktop.png', summary: 'Player overview · Desktop' },
      { area: 'Player overview', device: 'mobile', image: 'https://images.example/player-mobile.png', summary: 'Player overview - móvil' },
    ],
  });
  assert.deepEqual(parseVisualEvidence('no markers'), { hasMarkers: false, entries: [] });
  assert.deepEqual(parseVisualEvidence(`${VISUAL_EVIDENCE_MARKERS.end}${VISUAL_EVIDENCE_MARKERS.start}`), { hasMarkers: false, entries: [] });
});

test('does not require evidence for backend-only changes', () => {
  assert.deepEqual(validateVisualEvidence('', ['supabase/migrations/one.sql', 'README.md', 'README.md']), {
    required: false,
    frontendFiles: [],
    errors: [],
  });
});

test('requires the repository marker block and at least one evidence pair', () => {
  assert.deepEqual(validateVisualEvidence('plain body', ['public/app.js']), {
    required: true,
    frontendFiles: ['public/app.js'],
    errors: ['Missing visual evidence marker block. Use the repository pull request template.'],
  });
  assert.deepEqual(validateVisualEvidence(block(details('Animation · GIF')), ['public/app.js']), {
    required: true,
    frontendFiles: ['public/app.js'],
    errors: ['Add at least one paired Desktop/Mobile visual evidence area.'],
  });
});

test('accepts complete desktop and mobile evidence with case-insensitive area matching', () => {
  const body = block([
    details('Ranking · Desktop', 'https://github.com/user-attachments/assets/desktop'),
    details('ranking — Mobile', 'https://github.com/user-attachments/assets/mobile'),
  ].join('\n'));
  assert.deepEqual(validateVisualEvidence(body, ['public/ranking.html', 'public/ranking.html']), {
    required: true,
    frontendFiles: ['public/ranking.html'],
    errors: [],
  });
});

test('reports missing images, placeholders, missing counterparts and duplicates once', () => {
  const body = block([
    details('Home · Desktop', null),
    details('Home · Desktop', 'PASTE_DESKTOP_URL'),
    details('Profile · Mobile', 'https://example.com/mobile.png'),
    details('Ranking - Escritorio', 'https://images.example/ranking.png'),
    details('Ranking - Móvil', 'https://images.example/ranking-mobile.png'),
    details('Ranking - Mobile', 'https://images.example/ranking-mobile-2.png'),
  ].join('\n'));
  const result = validateVisualEvidence(body, ['public/index.html']);
  assert.deepEqual(result.frontendFiles, ['public/index.html']);
  assert.equal(result.required, true);
  assert.deepEqual(result.errors, [
    'Home · Desktop: missing Markdown image.',
    'Home · Desktop: replace the placeholder image URL.',
    'Profile · Mobile: replace the placeholder image URL.',
    'Home: missing Mobile evidence.',
    'Home: duplicate Desktop evidence.',
    'Profile: missing Desktop evidence.',
    'Ranking: duplicate Mobile evidence.',
  ]);
});
