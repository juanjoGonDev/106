import { ImageResponse } from 'npm:@vercel/og@0.11.1';
import React from 'npm:react@19.2.7';
import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const WIDTH = 1200;
const HEIGHT = 630;
const SECTIONS = new Set(['overview', 'achievements', 'trophies']);
const DEFAULT_SITE_URL = 'https://juanjogondev.github.io/106';
const SITE_ROUTE = '_site';
const RADAR_LABELS = Object.freeze([
  Object.freeze({ label: 'PRECISIÓN', left: 120, top: 0, width: 100, justifyContent: 'center' }),
  Object.freeze({ label: 'REGULARIDAD', left: 258, top: 101, width: 82, justifyContent: 'flex-start' }),
  Object.freeze({ label: 'EXPERIENCIA', left: 245, top: 286, width: 95, justifyContent: 'flex-start' }),
  Object.freeze({ label: 'FIABILIDAD', left: 0, top: 286, width: 95, justifyContent: 'flex-end' }),
  Object.freeze({ label: 'IMPACTO', left: 0, top: 101, width: 82, justifyContent: 'flex-end' }),
]);
const PLAYER_TEMPLATE_FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g"><stop stop-color="#650018"/><stop offset=".48" stop-color="#080a10"/><stop offset="1" stop-color="#10264f"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><rect x="52" y="52" width="690" height="526" rx="30" fill="#11151e"/><rect x="766" y="52" width="382" height="526" rx="30" fill="#0a0f18"/></svg>`;
const SITE_TEMPLATE_FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g"><stop stop-color="#72001c"/><stop offset=".5" stop-color="#080a10"/><stop offset="1" stop-color="#176397"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="600" cy="292" r="178" fill="#06080e"/><path d="M66 468Q600 330 1134 468V574H66Z" fill="#080b11"/></svg>`;

function resolveServiceKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = resolveServiceKey();
if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase function environment variables.');
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const h = React.createElement;
const templatePromises = new Map<string, Promise<string>>();

function normalizeNick(value: unknown) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function normalizeSection(value: unknown) {
  const section = String(value ?? '').toLowerCase().replace(/\.png$/, '');
  if (section === 'card') return 'overview';
  return SECTIONS.has(section) ? section : 'overview';
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] as string);
}

function decodeRouteValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseRoute(request: Request) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('player-share');
  const route = functionIndex >= 0 ? parts.slice(functionIndex + 1) : [];
  const first = route[0] ?? '';
  const tail = route[1] ?? '';
  const image = tail.toLowerCase().endsWith('.png') || url.searchParams.get('format') === 'png';
  if (first === SITE_ROUTE) return { kind: 'site' as const, image, section: 'overview', nick: '' };
  return {
    kind: 'player' as const,
    nick: normalizeNick(decodeRouteValue(first) || url.searchParams.get('nick')),
    section: normalizeSection(tail || url.searchParams.get('section')),
    image,
  };
}

function firstHeaderValue(request: Request, name: string) {
  return request.headers.get(name)?.split(',')[0]?.trim() ?? '';
}

function forwardedParameter(request: Request, name: string) {
  const forwarded = request.headers.get('forwarded') ?? '';
  const match = forwarded.match(new RegExp(`(?:^|[;,]\\s*)${name}=(?:"([^"]+)"|([^;,]+))`, 'i'));
  return (match?.[1] ?? match?.[2] ?? '').trim();
}

function publicShareBaseUrl(request: Request) {
  const configured = String(Deno.env.get('PUBLIC_SHARE_BASE_URL') ?? '').trim();
  if (configured) return new URL(`${configured.replace(/\/$/, '')}/`);

  const host = firstHeaderValue(request, 'x-forwarded-host')
    || forwardedParameter(request, 'host')
    || firstHeaderValue(request, 'host');
  const protocol = firstHeaderValue(request, 'x-forwarded-proto')
    || forwardedParameter(request, 'proto')
    || new URL(request.url).protocol.replace(':', '')
    || 'https';
  if (host && !host.startsWith('supabase_edge_runtime_')) {
    return new URL(`${protocol}://${host}/functions/v1/player-share/`);
  }

  const configuredSupabaseUrl = new URL(supabaseUrl);
  if (configuredSupabaseUrl.hostname.endsWith('.supabase.co')) {
    return new URL(`${configuredSupabaseUrl.origin}/functions/v1/player-share/`);
  }

  const internalUrl = new URL(request.url);
  return new URL(`${internalUrl.origin}/player-share/`);
}

function playerShareUrl(request: Request, nick: string, section: string) {
  const url = publicShareBaseUrl(request);
  const suffix = section === 'overview' ? '' : `/${section}`;
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(nick)}${suffix}`;
  return url;
}

function playerImageUrl(request: Request, nick: string, section: string) {
  const url = publicShareBaseUrl(request);
  const imageName = section === 'overview' ? 'card' : section;
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(nick)}/${imageName}.png`;
  return url;
}

function siteImageUrl(request: Request) {
  const url = publicShareBaseUrl(request);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${SITE_ROUTE}/card.png`;
  return url;
}

function encodeSvgDataUri(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

async function loadTemplate(fileName: string, fallback: string) {
  const cached = templatePromises.get(fileName);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const svg = await Deno.readTextFile(new URL(`./${fileName}`, import.meta.url));
      if (!svg.includes('<svg') || !svg.includes('width="1200"') || !svg.includes('height="630"')) throw new Error('Invalid template');
      return encodeSvgDataUri(svg);
    } catch {
      return encodeSvgDataUri(fallback);
    }
  })();
  templatePromises.set(fileName, promise);
  return promise;
}

async function getProfile(nick: string) {
  const key = nick.toLocaleLowerCase('es');
  const { data, error } = await supabase.rpc('get_game_public_profile', { p_nick_key: key });
  if (error) throw new Error('Profile query failed');
  return data as Record<string, unknown>;
}

function hasNumber(value: unknown) {
  return Number.isFinite(Number(value));
}

function difference(value: unknown) {
  return hasNumber(value) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—';
}

function truncate(value: unknown, maximum: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function nickFontSize(nick: string) {
  if (nick.length > 20) return 42;
  if (nick.length > 15) return 50;
  return 58;
}

function teamIdentity(profile: Record<string, unknown>) {
  const history = Array.isArray(profile.history) ? profile.history as Array<Record<string, unknown>> : [];
  const team = String(profile.team || history.find((attempt) => ['spain', 'argentina'].includes(String(attempt.team)))?.team || '');
  return team === 'argentina'
    ? { key: 'argentina', name: 'Argentina', colors: ['#74acdf', '#ffffff', '#74acdf'] }
    : { key: 'spain', name: 'España', colors: ['#aa151b', '#f1bf00', '#aa151b'] };
}

function radarStats(profile: Record<string, unknown>) {
  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const inverse = (value: unknown, maximum: number) => hasNumber(value) ? clamp(100 - Number(value) / maximum * 100) : 0;
  const attemptsUsed = Math.max(0, Number(profile.attemptsUsed) || 0);
  const verifiedAttempts = Math.max(0, Number(profile.verifiedAttempts) || 0);
  const completedReferrals = Math.max(0, Number(profile.completedReferrals) || 0);
  const bonusAttempts = Math.max(0, Number(profile.bonusAttempts) || 0);
  return [
    inverse(profile.bestDifferenceMs, 1000),
    inverse(profile.averageDifferenceMs, 1500),
    clamp(verifiedAttempts / 20 * 100),
    attemptsUsed ? clamp(verifiedAttempts / attemptsUsed * 100) : 0,
    clamp(completedReferrals * 20 + bonusAttempts * 8),
  ];
}

function radarPoint(index: number, radius: number, center = 170) {
  const angle = -Math.PI / 2 + Math.PI * 2 * index / RADAR_LABELS.length;
  return {
    x: center + Math.cos(angle) * radius,
    y: center + Math.sin(angle) * radius,
  };
}

function polygonPoints(values: number[], radius = 112, center = 170) {
  return values.map((value, index) => {
    const point = radarPoint(index, radius * value / 100, center);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(' ');
}

function radarElement(stats: number[], nick: string) {
  const grid = [];
  for (const level of [20, 40, 60, 80, 100]) {
    grid.push(h('polygon', {
      key: `grid-${level}`,
      points: polygonPoints(RADAR_LABELS.map(() => level)),
      fill: 'none',
      stroke: level === 100 ? 'rgba(255,255,255,.20)' : 'rgba(255,255,255,.12)',
      strokeWidth: 2,
    }));
  }
  const axes = RADAR_LABELS.map((axis, index) => {
    const end = radarPoint(index, 112);
    return h('line', {
      key: `axis-${axis.label}`,
      x1: 170,
      y1: 170,
      x2: end.x,
      y2: end.y,
      stroke: 'rgba(255,255,255,.10)',
      strokeWidth: 1,
    });
  });
  const points = stats.map((value, index) => {
    const point = radarPoint(index, 112 * value / 100);
    return h('circle', {
      key: `point-${index}`,
      cx: point.x,
      cy: point.y,
      r: 4,
      fill: '#f4c95d',
      stroke: '#090d15',
      strokeWidth: 2,
    });
  });
  const labels = RADAR_LABELS.map((axis) => h('div', {
    key: axis.label,
    style: {
      position: 'absolute',
      left: axis.left,
      top: axis.top,
      display: 'flex',
      width: axis.width,
      justifyContent: axis.justifyContent,
      color: '#d4d7df',
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1,
      whiteSpace: 'nowrap',
    },
  }, axis.label));
  return h('div', {
    style: { position: 'absolute', left: 787, top: 108, display: 'flex', width: 340, height: 370 },
  },
  h('svg', {
    width: 340,
    height: 315,
    viewBox: '0 0 340 315',
    style: { position: 'absolute', left: 0, top: 20 },
  },
  ...grid,
  ...axes,
  h('polygon', { points: polygonPoints(stats), fill: 'rgba(244,201,93,.28)', stroke: '#f4c95d', strokeWidth: 4, strokeLinejoin: 'round' }),
  ...points),
  ...labels,
  h('div', { style: { position: 'absolute', left: 80, top: 342, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: 180, color: '#d4d7df', fontSize: 12, lineHeight: 1 } },
    h('span', { style: { display: 'flex', width: 8, height: 8, borderRadius: 999, background: '#f4c95d' } }),
    h('span', { style: { display: 'flex', maxWidth: 156, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, truncate(nick, 18)),
  ));
}

function flagElement(team: ReturnType<typeof teamIdentity>, width = 46, height = 30) {
  return h('div', { style: { display: 'flex', width, height, overflow: 'hidden', borderRadius: 6, border: '1px solid rgba(255,255,255,.5)', flexDirection: 'column', boxSizing: 'border-box' } },
    ...team.colors.map((color, index) => h('div', { key: `${color}-${index}`, style: { display: 'flex', flex: 1, background: color } })),
  );
}

function metric(label: string, value: string) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', width: 190, height: 78, padding: '12px 13px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, background: 'rgba(255,255,255,.045)', boxSizing: 'border-box', overflow: 'hidden' } },
    h('span', { style: { display: 'flex', color: '#9ca3af', fontSize: 13, lineHeight: 1.1, letterSpacing: 1.1 } }, label),
    h('strong', { style: { display: 'flex', color: '#ffffff', fontSize: 23, lineHeight: 1.05, marginTop: 8, whiteSpace: 'nowrap' } }, value),
  );
}

function sectionRows(profile: Record<string, unknown>, section: string) {
  const trophies = (profile.trophies || {}) as Record<string, unknown>;
  const achievements = (profile.achievements || {}) as Record<string, unknown>;
  if (section === 'achievements') {
    const items = Array.isArray(achievements.items) ? achievements.items.slice(0, 3) as Array<Record<string, unknown>> : [];
    return items.map((item) => truncate(`${String(item.title || 'Logro')} · ${Number(item.points || 0)} pt`, 48));
  }
  if (section === 'trophies') {
    const names: Record<string, string> = { golden_boot: 'Bota de Oro', golden_glove: 'Guante de Oro', golden_ball: 'Balón de Oro' };
    const items = Array.isArray(trophies.history) ? trophies.history.slice(0, 3) as Array<Record<string, unknown>> : [];
    return items.map((item) => truncate(`${names[String(item.type)] || 'Trofeo'} · ${String(item.date || '')}`, 48));
  }
  return [
    `${Number(trophies.total || 0)} trofeos acumulados`,
    `${Number(achievements.total || 0)} logros desbloqueados`,
    `${Number(achievements.points || 0)} puntos de impacto`,
  ];
}

async function playerCardResponse(profile: Record<string, unknown>, section: string) {
  const template = await loadTemplate('player-card-template.svg', PLAYER_TEMPLATE_FALLBACK);
  const team = teamIdentity(profile);
  const trophies = (profile.trophies || {}) as Record<string, unknown>;
  const achievements = (profile.achievements || {}) as Record<string, unknown>;
  const stats = radarStats(profile);
  const sectionLabel = section === 'achievements' ? 'LOGROS' : section === 'trophies' ? 'TROFEOS' : 'PERFIL GLOBAL';
  const rows = sectionRows(profile, section);
  const nick = truncate(profile.nick || 'Jugador', 24);

  const element = h('div', { style: { position: 'relative', display: 'flex', width: WIDTH, height: HEIGHT, overflow: 'hidden', color: '#fff', fontFamily: 'Arial, sans-serif', background: '#08090e' } },
    h('img', { src: template, width: WIDTH, height: HEIGHT, style: { position: 'absolute', inset: 0, width: WIDTH, height: HEIGHT } }),
    h('div', { style: { position: 'absolute', left: 82, top: 80, display: 'flex', color: '#f4c95d', fontSize: 18, fontWeight: 800, lineHeight: 1, letterSpacing: 4 } }, `MINUTO 106 · ${sectionLabel}`),
    h('div', { style: { position: 'absolute', left: 82, top: 118, display: 'flex', width: 620, height: 62, overflow: 'hidden', color: '#fff', fontSize: nickFontSize(nick), fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, nick),
    h('div', { style: { position: 'absolute', left: 82, top: 194, display: 'flex', alignItems: 'center', gap: 12, width: 620, color: '#d4d7df', fontSize: 21, lineHeight: 1 } },
      flagElement(team),
      h('span', { style: { display: 'flex' } }, team.name),
      h('span', { style: { display: 'flex', color: '#f4c95d', fontWeight: 800 } }, profile.globalRankBest ? `#${profile.globalRankBest} GLOBAL` : 'SIN PUESTO'),
    ),
    h('div', { style: { position: 'absolute', left: 82, top: 246, display: 'flex', gap: 10, width: 590, height: 78, overflow: 'hidden' } },
      metric('MEJOR MARCA', difference(profile.bestDifferenceMs)),
      metric('MEDIA GLOBAL', difference(profile.averageDifferenceMs)),
      metric('INTENTOS VÁLIDOS', String(Number(profile.verifiedAttempts || 0))),
    ),
    h('div', { style: { position: 'absolute', left: 82, top: 350, display: 'flex', flexDirection: 'column', gap: 9, width: 610, height: 92, overflow: 'hidden' } },
      ...rows.map((row, index) => h('div', { key: `${row}-${index}`, style: { display: 'flex', width: 610, color: index === 0 ? '#f4c95d' : '#d4d7df', fontSize: 18, fontWeight: index === 0 ? 800 : 600, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, `• ${row}`)),
    ),
    h('div', { style: { position: 'absolute', left: 82, top: 520, display: 'flex', color: '#f4c95d', fontSize: 18, fontWeight: 800, lineHeight: 1, letterSpacing: 2 } }, '¿PUEDES SUPERARME?'),
    h('div', { style: { position: 'absolute', left: 800, top: 82, display: 'flex', width: 314, justifyContent: 'center', color: '#f4c95d', fontSize: 17, fontWeight: 800, lineHeight: 1, letterSpacing: 3 } }, 'PENTÁGONO'),
    radarElement(stats, nick),
    h('div', { style: { position: 'absolute', left: 798, top: 514, display: 'flex', justifyContent: 'space-between', width: 318, color: '#fff', fontSize: 17, fontWeight: 800, lineHeight: 1 } },
      h('span', { style: { display: 'flex' } }, `TROFEOS ${Number(trophies.total || 0)}`),
      h('span', { style: { display: 'flex' } }, `LOGROS ${Number(achievements.total || 0)}`),
      h('span', { style: { display: 'flex', color: '#f4c95d' } }, `${Number(achievements.points || 0)} PT`),
    ),
  );

  return new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
      'Content-Disposition': `inline; filename="minuto-106-${encodeURIComponent(String(profile.nick || 'player'))}-${section}.png"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function siteCardResponse() {
  const template = await loadTemplate('site-card-template.svg', SITE_TEMPLATE_FALLBACK);
  const element = h('div', { style: { position: 'relative', display: 'flex', width: WIDTH, height: HEIGHT, overflow: 'hidden', color: '#fff', fontFamily: 'Arial, sans-serif', background: '#08090e' } },
    h('img', { src: template, width: WIDTH, height: HEIGHT, style: { position: 'absolute', inset: 0, width: WIDTH, height: HEIGHT } }),
    h('div', { style: { position: 'absolute', left: 64, top: 58, display: 'flex', padding: '12px 20px', border: '2px solid #f4c95d', borderRadius: 22, background: 'rgba(5,7,13,.88)', color: '#f4c95d', fontSize: 18, fontWeight: 900, lineHeight: 1, letterSpacing: 2, boxSizing: 'border-box' } }, 'MINUTO 106'),
    h('div', { style: { position: 'absolute', left: 92, top: 112, display: 'flex', alignItems: 'center', gap: 13, width: 350, color: '#ffd54c', fontSize: 50, fontWeight: 900, lineHeight: 1 } },
      flagElement({ key: 'spain', name: 'España', colors: ['#aa151b', '#f1bf00', '#aa151b'] }, 54, 36),
      h('span', { style: { display: 'flex' } }, 'ESPAÑA'),
    ),
    h('div', { style: { position: 'absolute', right: 92, top: 112, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 13, width: 390, color: '#78d2fa', fontSize: 50, fontWeight: 900, lineHeight: 1 } },
      h('span', { style: { display: 'flex' } }, 'ARGENTINA'),
      flagElement({ key: 'argentina', name: 'Argentina', colors: ['#74acdf', '#ffffff', '#74acdf'] }, 54, 36),
    ),
    h('div', { style: { position: 'absolute', left: 558, top: 126, display: 'flex', width: 84, justifyContent: 'center', color: '#fff', fontSize: 28, fontWeight: 900, lineHeight: 1 } }, 'VS'),
    h('div', { style: { position: 'absolute', left: 450, top: 196, display: 'flex', width: 300, justifyContent: 'center', color: '#cfd4de', fontSize: 18, fontWeight: 800, lineHeight: 1, letterSpacing: 5 } }, 'OBJETIVO'),
    h('div', { style: { position: 'absolute', left: 390, top: 235, display: 'flex', width: 420, height: 108, justifyContent: 'center', overflow: 'hidden', color: '#fff', fontSize: 94, fontWeight: 900, lineHeight: 1, letterSpacing: -3, whiteSpace: 'nowrap' } }, '10.600'),
    h('div', { style: { position: 'absolute', left: 430, top: 353, display: 'flex', width: 340, justifyContent: 'center', color: '#f4c95d', fontSize: 19, fontWeight: 900, lineHeight: 1, letterSpacing: 2 } }, 'SEGUNDOS EXACTOS'),
    h('div', { style: { position: 'absolute', left: 126, top: 474, display: 'flex', width: 948, justifyContent: 'center', color: '#fff', fontSize: 34, fontWeight: 900, lineHeight: 1 } }, '¿PUEDES CLAVAR EL 10.600?'),
    h('div', { style: { position: 'absolute', left: 214, top: 522, display: 'flex', justifyContent: 'space-between', width: 772, color: '#e6eaf1', fontSize: 18, fontWeight: 800, lineHeight: 1 } },
      h('span', { style: { display: 'flex' } }, '5 INTENTOS'),
      h('span', { style: { display: 'flex', color: '#f4c95d' } }, 'RANKING GLOBAL'),
      h('span', { style: { display: 'flex' } }, 'MINILIGAS'),
    ),
    h('div', { style: { position: 'absolute', left: 390, top: 562, display: 'flex', width: 420, height: 38, alignItems: 'center', justifyContent: 'center', color: '#08090e', fontSize: 19, fontWeight: 900, lineHeight: 1, letterSpacing: 1 } }, 'JUEGA AHORA'),
  );

  return new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'Content-Disposition': 'inline; filename="minuto-106-social.png"',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function playerHtmlResponse(request: Request, profile: Record<string, unknown>, section: string) {
  const siteUrl = String(Deno.env.get('PUBLIC_SITE_URL') || DEFAULT_SITE_URL).replace(/\/$/, '');
  const nick = String(profile.nick || 'Jugador');
  const suffix = section === 'overview' ? '' : `/${section}`;
  const canonical = `${siteUrl}/player/${encodeURIComponent(nick)}${suffix}`;
  const shareUrl = playerShareUrl(request, nick, section);
  const imageUrl = playerImageUrl(request, nick, section);
  const trophies = Number((profile.trophies as Record<string, unknown> | undefined)?.total || 0);
  const achievements = Number((profile.achievements as Record<string, unknown> | undefined)?.total || 0);
  const title = `${nick} · Minuto 106`;
  const description = `${nick}: ${difference(profile.bestDifferenceMs)}, ${trophies} trofeos, ${achievements} logros y ${Number((profile.achievements as Record<string, unknown> | undefined)?.points || 0)} puntos.`;
  const imageAlt = `Tarjeta de ${nick} con estadísticas, trofeos, logros y pentágono de rendimiento en Minuto 106.`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:locale" content="es_ES"><meta property="og:type" content="profile"><meta property="og:site_name" content="Minuto 106"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl.toString())}"><meta property="og:image" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:secure_url" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(imageAlt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}"><meta name="twitter:image:src" content="${escapeHtml(imageUrl.toString())}"><meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}"><meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}"><script>location.replace(${JSON.stringify(canonical)})</script></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p><a href="${escapeHtml(canonical)}">Abrir perfil</a></p></main></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=1800',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function siteHtmlResponse(request: Request) {
  const canonical = `${String(Deno.env.get('PUBLIC_SITE_URL') || DEFAULT_SITE_URL).replace(/\/$/, '')}/`;
  const imageUrl = siteImageUrl(request);
  const title = 'España vs. Argentina — Minuto 106';
  const description = 'Detén el reloj exactamente en 10,600 segundos, elige España o Argentina y defiende tu puesto en el ranking global.';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:secure_url" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}"><meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}"></head><body><a href="${escapeHtml(canonical)}">Abrir Minuto 106</a></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=900', 'X-Content-Type-Options': 'nosniff' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });

  try {
    const route = parseRoute(request);
    if (route.kind === 'site') {
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      return route.image ? await siteCardResponse() : siteHtmlResponse(request);
    }

    if (route.nick.length < 2) return new Response('Jugador no válido', { status: 400 });
    const profile = await getProfile(route.nick);
    if (!profile?.nick) return new Response('Jugador no encontrado', { status: 404 });
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
    return route.image ? await playerCardResponse(profile, route.section) : playerHtmlResponse(request, profile, route.section);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return new Response('No se pudo generar el perfil compartido.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
});