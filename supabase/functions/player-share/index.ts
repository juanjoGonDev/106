import { ImageResponse } from 'npm:@vercel/og@0.11.1';
import React from 'npm:react@19.2.7';
import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const WIDTH = 1200;
const HEIGHT = 630;
const SECTIONS = new Set(['overview', 'achievements', 'trophies']);
const DEFAULT_SITE_URL = 'https://juanjogondev.github.io/106';
const TEMPLATE_FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g"><stop stop-color="#68001b"/><stop offset=".5" stop-color="#08090e"/><stop offset="1" stop-color="#122b5c"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><rect x="60" y="70" width="655" height="490" rx="30" fill="#0d0f16" stroke="#f4c95d" stroke-opacity=".25"/><rect x="740" y="70" width="400" height="490" rx="30" fill="#0c0f17" stroke="#fff" stroke-opacity=".14"/></svg>`;

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
let templatePromise: Promise<string> | null = null;

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

function parseRoute(request: Request) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('player-share');
  const route = functionIndex >= 0 ? parts.slice(functionIndex + 1) : [];
  const nick = (() => {
    try {
      return decodeURIComponent(route[0] ?? '');
    } catch {
      return route[0] ?? '';
    }
  })();
  const tail = route[1] ?? '';
  return {
    nick: normalizeNick(nick || url.searchParams.get('nick')),
    section: normalizeSection(tail || url.searchParams.get('section')),
    image: tail.endsWith('.png') || url.searchParams.get('format') === 'png',
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

function encodeSvgDataUri(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

async function loadTemplate() {
  if (templatePromise) return templatePromise;
  templatePromise = (async () => {
    const siteUrl = String(Deno.env.get('PUBLIC_SITE_URL') || DEFAULT_SITE_URL).replace(/\/$/, '');
    try {
      const response = await fetch(`${siteUrl}/assets/player-card-template.svg`, { headers: { accept: 'image/svg+xml' } });
      if (!response.ok) throw new Error('Template unavailable');
      const svg = await response.text();
      if (!svg.includes('<svg')) throw new Error('Invalid template');
      return encodeSvgDataUri(svg);
    } catch {
      return encodeSvgDataUri(TEMPLATE_FALLBACK);
    }
  })();
  return templatePromise;
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
  const attempts = Math.max(0, Number(profile.attemptsUsed) || 0);
  const verified = Math.max(0, Number(profile.verifiedAttempts) || 0);
  return [
    inverse(profile.bestDifferenceMs, 1000),
    inverse(profile.averageDifferenceMs, 1500),
    clamp(verified / 20 * 100),
    attempts ? clamp(verified / attempts * 100) : 0,
    clamp((Number(profile.achievements && (profile.achievements as Record<string, unknown>).points) || 0) / 2),
  ];
}

function polygonPoints(values: number[], radius = 112, center = 150) {
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + Math.PI * 2 * index / values.length;
    const distance = radius * value / 100;
    return `${(center + Math.cos(angle) * distance).toFixed(2)},${(center + Math.sin(angle) * distance).toFixed(2)}`;
  }).join(' ');
}

function flagElement(team: ReturnType<typeof teamIdentity>) {
  return h('div', { style: { display: 'flex', width: 48, height: 32, overflow: 'hidden', borderRadius: 6, border: '1px solid rgba(255,255,255,.5)', flexDirection: 'column' } },
    ...team.colors.map((color, index) => h('div', { key: `${color}-${index}`, style: { display: 'flex', flex: 1, background: color } })),
  );
}

function metric(label: string, value: string) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', width: 170, height: 72, padding: '12px 14px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, background: 'rgba(255,255,255,.045)' } },
    h('span', { style: { color: '#9ca3af', fontSize: 16 } }, label),
    h('strong', { style: { color: '#ffffff', fontSize: 25, marginTop: 5 } }, value),
  );
}

function sectionRows(profile: Record<string, unknown>, section: string) {
  const trophies = (profile.trophies || {}) as Record<string, unknown>;
  const achievements = (profile.achievements || {}) as Record<string, unknown>;
  if (section === 'achievements') {
    const items = Array.isArray(achievements.items) ? achievements.items.slice(0, 3) as Array<Record<string, unknown>> : [];
    return items.map((item) => `${String(item.title || 'Logro')} · ${Number(item.points || 0)} pt`);
  }
  if (section === 'trophies') {
    const names: Record<string, string> = { golden_boot: 'Bota de Oro', golden_glove: 'Guante de Oro', golden_ball: 'Balón de Oro' };
    const items = Array.isArray(trophies.history) ? trophies.history.slice(0, 3) as Array<Record<string, unknown>> : [];
    return items.map((item) => `${names[String(item.type)] || 'Trofeo'} · ${String(item.date || '')}`);
  }
  return [
    `${Number(trophies.total || 0)} trofeos`,
    `${Number(achievements.total || 0)} logros`,
    `${Number(achievements.points || 0)} puntos`,
  ];
}

async function cardResponse(profile: Record<string, unknown>, section: string) {
  const template = await loadTemplate();
  const team = teamIdentity(profile);
  const trophies = (profile.trophies || {}) as Record<string, unknown>;
  const achievements = (profile.achievements || {}) as Record<string, unknown>;
  const stats = radarStats(profile);
  const labels = ['PRECISIÓN', 'REGULARIDAD', 'EXPERIENCIA', 'FIABILIDAD', 'IMPACTO'];
  const sectionLabel = section === 'achievements' ? 'LOGROS' : section === 'trophies' ? 'TROFEOS' : 'PERFIL GLOBAL';
  const rows = sectionRows(profile, section);

  const element = h('div', { style: { position: 'relative', display: 'flex', width: WIDTH, height: HEIGHT, color: '#fff', fontFamily: 'Noto Sans, sans-serif' } },
    h('img', { src: template, width: WIDTH, height: HEIGHT, style: { position: 'absolute', inset: 0, width: WIDTH, height: HEIGHT } }),
    h('div', { style: { position: 'absolute', left: 86, top: 112, display: 'flex', flexDirection: 'column', width: 580 } },
      h('div', { style: { display: 'flex', color: '#f4c95d', fontSize: 20, fontWeight: 800, letterSpacing: 5 } }, `MINUTO 106 · ${sectionLabel}`),
      h('div', { style: { display: 'flex', marginTop: 26, color: '#fff', fontSize: 62, fontWeight: 900, lineHeight: 1, maxWidth: 570, overflow: 'hidden' } }, String(profile.nick || 'Jugador')),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, color: '#d4d7df', fontSize: 22 } }, flagElement(team), team.name, profile.globalRankBest ? ` · #${profile.globalRankBest} GLOBAL` : ''),
      h('div', { style: { display: 'flex', gap: 12, marginTop: 34 } },
        metric('MEJOR MARCA', difference(profile.bestDifferenceMs)),
        metric('MEDIA', difference(profile.averageDifferenceMs)),
        metric('INTENTOS VÁLIDOS', String(Number(profile.verifiedAttempts || 0))),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24 } },
        ...rows.map((row, index) => h('div', { key: `${row}-${index}`, style: { display: 'flex', color: index === 0 ? '#f4c95d' : '#d4d7df', fontSize: 21, fontWeight: index === 0 ? 800 : 600 } }, `• ${row}`)),
      ),
      h('div', { style: { display: 'flex', color: '#f4c95d', fontSize: 19, fontWeight: 800, marginTop: 22, letterSpacing: 2 } }, '¿PUEDES SUPERARME?'),
    ),
    h('div', { style: { position: 'absolute', left: 780, top: 118, display: 'flex', flexDirection: 'column', width: 320, alignItems: 'center' } },
      h('div', { style: { display: 'flex', color: '#f4c95d', fontSize: 18, fontWeight: 800, letterSpacing: 3 } }, 'PENTÁGONO'),
      h('svg', { width: 300, height: 300, viewBox: '0 0 300 300', style: { marginTop: 8 } },
        h('polygon', { points: polygonPoints([100, 100, 100, 100, 100]), fill: 'none', stroke: 'rgba(255,255,255,.18)', strokeWidth: 2 }),
        h('polygon', { points: polygonPoints([75, 75, 75, 75, 75]), fill: 'none', stroke: 'rgba(255,255,255,.12)', strokeWidth: 2 }),
        h('polygon', { points: polygonPoints([50, 50, 50, 50, 50]), fill: 'none', stroke: 'rgba(255,255,255,.12)', strokeWidth: 2 }),
        h('polygon', { points: polygonPoints(stats), fill: 'rgba(244,201,93,.28)', stroke: '#f4c95d', strokeWidth: 4 }),
      ),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '7px 14px', color: '#c8cdd6', fontSize: 13, marginTop: -8 } },
        ...labels.map((label, index) => h('span', { key: label, style: { display: 'flex' } }, `${label} ${stats[index]}`)),
      ),
      h('div', { style: { display: 'flex', gap: 18, marginTop: 24, color: '#fff', fontSize: 19, fontWeight: 800 } },
        h('span', null, `🏆 ${Number(trophies.total || 0)}`),
        h('span', null, `★ ${Number(achievements.total || 0)}`),
        h('span', null, `${Number(achievements.points || 0)} PT`),
      ),
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

function htmlResponse(request: Request, profile: Record<string, unknown>, section: string) {
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
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:locale" content="es_ES"><meta property="og:type" content="profile"><meta property="og:site_name" content="Minuto 106"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl.toString())}"><meta property="og:image" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}"><meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}"><script>location.replace(${JSON.stringify(canonical)})</script></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p><a href="${escapeHtml(canonical)}">Abrir perfil</a></p></main></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=1800',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });

  try {
    const route = parseRoute(request);
    if (route.nick.length < 2) return new Response('Jugador no válido', { status: 400 });
    const profile = await getProfile(route.nick);
    if (!profile?.nick) return new Response('Jugador no encontrado', { status: 404 });
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
    return route.image ? await cardResponse(profile, route.section) : htmlResponse(request, profile, route.section);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return new Response('No se pudo generar el perfil compartido.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
});