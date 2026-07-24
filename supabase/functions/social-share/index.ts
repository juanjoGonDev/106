import { ImageResponse } from 'npm:@vercel/og@0.11.1';
import React from 'npm:react@19.2.7';
import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const WIDTH = 1200;
const HEIGHT = 630;
const DEFAULT_SITE_URL = 'https://juanjogondev.github.io/106';
const PLAYER_SECTIONS = new Set(['overview', 'achievements', 'trophies']);
const h = React.createElement;

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

function decodeRouteValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeNick(value: unknown) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function normalizeLeagueCode(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
}

function normalizeSection(value: unknown) {
  const section = String(value ?? '').toLowerCase();
  return PLAYER_SECTIONS.has(section) ? section : 'overview';
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] as string);
}

function truncate(value: unknown, maximum: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function parseRoute(request: Request) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('social-share');
  const route = functionIndex >= 0 ? parts.slice(functionIndex + 1) : [];
  const kind = route[0] ?? '';
  if (kind === 'player') {
    return {
      kind: 'player' as const,
      nick: normalizeNick(decodeRouteValue(route[1] ?? '')),
      section: normalizeSection(route[2]),
      image: false,
    };
  }
  if (kind === 'league') {
    return {
      kind: 'league' as const,
      code: normalizeLeagueCode(decodeRouteValue(route[1] ?? '')),
      image: String(route[2] ?? '').toLowerCase() === 'card.png' || url.searchParams.get('format') === 'png',
    };
  }
  return { kind: 'invalid' as const, image: false };
}

function functionBaseUrl(request: Request, functionName: string) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('social-share');
  const prefix = functionIndex >= 0 ? parts.slice(0, functionIndex) : ['functions', 'v1'];
  url.pathname = `/${[...prefix, functionName].join('/')}`;
  url.search = '';
  url.hash = '';
  return url;
}

function versioned(url: URL, revision: unknown) {
  const normalized = Math.max(0, Number(revision) || 0);
  url.searchParams.set('v', String(Math.trunc(normalized)));
  return url;
}

function siteBaseUrl() {
  return String(Deno.env.get('PUBLIC_SITE_URL') || DEFAULT_SITE_URL).replace(/\/$/, '');
}

function profileCanonical(nick: string, section: string) {
  const suffix = section === 'overview' ? '' : `/${section}`;
  return `${siteBaseUrl()}/player/${encodeURIComponent(nick)}${suffix}`;
}

function leagueCanonical(code: string) {
  return `${siteBaseUrl()}/ligas.html?league=${encodeURIComponent(code)}`;
}

function profileShareUrl(request: Request, nick: string, section: string, revision: unknown) {
  const url = functionBaseUrl(request, 'social-share');
  const suffix = section === 'overview' ? '' : `/${section}`;
  url.pathname += `/player/${encodeURIComponent(nick)}${suffix}`;
  return versioned(url, revision);
}

function profileImageUrl(request: Request, nick: string, section: string, revision: unknown) {
  const url = functionBaseUrl(request, 'player-share');
  const imageName = section === 'overview' ? 'card' : section;
  url.pathname += `/${encodeURIComponent(nick)}/${imageName}.png`;
  return versioned(url, revision);
}

function leagueShareUrl(request: Request, code: string, revision: unknown) {
  const url = functionBaseUrl(request, 'social-share');
  url.pathname += `/league/${encodeURIComponent(code)}`;
  return versioned(url, revision);
}

function leagueImageUrl(request: Request, code: string, revision: unknown) {
  const url = functionBaseUrl(request, 'social-share');
  url.pathname += `/league/${encodeURIComponent(code)}/card.png`;
  return versioned(url, revision);
}

async function getProfile(nick: string) {
  const { data, error } = await supabase.rpc('get_game_public_profile', {
    p_nick_key: nick.toLocaleLowerCase('es'),
  });
  if (error) throw new Error('Profile query failed');
  return data as Record<string, unknown>;
}

async function getLeague(code: string) {
  const { data, error } = await supabase.rpc('get_game_league', { p_code: code });
  if (error) throw new Error('League query failed');
  return data as Record<string, unknown>;
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=1800',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function socialHtml({
  canonical,
  description,
  imageAlt,
  imageUrl,
  shareUrl,
  title,
  type,
}: {
  canonical: string;
  description: string;
  imageAlt: string;
  imageUrl: URL;
  shareUrl: URL;
  title: string;
  type: string;
}) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:locale" content="es_ES"><meta property="og:type" content="${escapeHtml(type)}"><meta property="og:site_name" content="Minuto 106"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl.toString())}"><meta property="og:image" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:secure_url" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(imageAlt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}"><meta name="twitter:image:src" content="${escapeHtml(imageUrl.toString())}"><meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}"><meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}"><script>location.replace(${JSON.stringify(canonical)})</script></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p><a href="${escapeHtml(canonical)}">Abrir Minuto 106</a></p></main></body></html>`;
  return htmlResponse(html);
}

function difference(value: unknown) {
  return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : 'Sin marca';
}

function leagueStatus(league: Record<string, unknown>) {
  if (league.waiting === true) return 'EN ESPERA';
  if (league.active === true) return 'EN JUEGO';
  return 'FINALIZADA';
}

function leagueDeadline(league: Record<string, unknown>) {
  if (league.waiting === true) return 'Empieza con 3 cuentas y 3 dispositivos únicos';
  const value = String(league.endsAt ?? '');
  if (!value) return 'Competición pendiente';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Competición activa';
  return `${league.finished === true ? 'Finalizó' : 'Termina'} ${date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' })}`;
}

function leagueMetric(label: string, value: string) {
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', width: 220, height: 92, padding: '16px 18px',
      border: '1px solid rgba(255,255,255,.16)', borderRadius: 18, background: 'rgba(255,255,255,.06)',
      boxSizing: 'border-box',
    },
  },
  h('span', { style: { display: 'flex', color: '#aeb5c3', fontSize: 14, fontWeight: 700, letterSpacing: 1.5 } }, label),
  h('strong', { style: { display: 'flex', color: '#fff', fontSize: 28, fontWeight: 900, marginTop: 10, whiteSpace: 'nowrap' } }, value));
}

function leagueLeaderboard(league: Record<string, unknown>) {
  const leaderboard = Array.isArray(league.leaderboard)
    ? (league.leaderboard as Array<Record<string, unknown>>).slice(0, 3)
    : [];
  if (!leaderboard.length) {
    return h('div', { style: { display: 'flex', color: '#b9c0cc', fontSize: 22, marginTop: 22 } }, 'Todavía no hay marcas verificadas.');
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18, width: 470 } },
    ...leaderboard.map((entry, index) => h('div', {
      key: `${entry.nick}-${index}`,
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 470, height: 54,
        padding: '0 16px', borderRadius: 14, background: index === 0 ? 'rgba(244,201,93,.16)' : 'rgba(255,255,255,.05)',
        border: index === 0 ? '1px solid rgba(244,201,93,.5)' : '1px solid rgba(255,255,255,.1)', boxSizing: 'border-box',
      },
    },
    h('span', { style: { display: 'flex', color: index === 0 ? '#f4c95d' : '#d9dde5', fontSize: 21, fontWeight: 900 } }, `#${entry.rank || index + 1} ${truncate(entry.nick, 20)}`),
    h('span', { style: { display: 'flex', color: '#fff', fontSize: 20, fontWeight: 800 } }, difference(entry.bestDifferenceMs)))),
  );
}

function leagueCardResponse(league: Record<string, unknown>) {
  const name = truncate(league.name || 'Miniliga', 38);
  const code = String(league.code || '------');
  const champion = league.champion as Record<string, unknown> | null;
  const status = leagueStatus(league);
  const statusColor = league.waiting === true ? '#f4c95d' : league.active === true ? '#68d391' : '#9ca3af';
  const element = h('div', {
    style: {
      position: 'relative', display: 'flex', width: WIDTH, height: HEIGHT, overflow: 'hidden', color: '#fff',
      fontFamily: 'Arial, sans-serif', background: 'linear-gradient(118deg,#650018 0%,#090b12 48%,#123b6b 100%)',
    },
  },
  h('div', { style: { position: 'absolute', inset: 32, display: 'flex', border: '1px solid rgba(255,255,255,.16)', borderRadius: 30, background: 'rgba(5,8,14,.84)' } }),
  h('div', { style: { position: 'absolute', left: 72, top: 62, display: 'flex', color: '#f4c95d', fontSize: 18, fontWeight: 900, letterSpacing: 4 } }, 'MINUTO 106 · MINILIGA'),
  h('div', { style: { position: 'absolute', right: 72, top: 58, display: 'flex', alignItems: 'center', gap: 12, padding: '11px 17px', border: `2px solid ${statusColor}`, borderRadius: 999, color: statusColor, fontSize: 17, fontWeight: 900, letterSpacing: 2 } }, status),
  h('div', { style: { position: 'absolute', left: 72, top: 112, display: 'flex', width: 720, height: 74, overflow: 'hidden', color: '#fff', fontSize: name.length > 28 ? 48 : 58, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, name),
  h('div', { style: { position: 'absolute', left: 74, top: 197, display: 'flex', alignItems: 'center', gap: 18, color: '#d5dae3', fontSize: 22, fontWeight: 700 } },
    h('span', { style: { display: 'flex', padding: '10px 16px', borderRadius: 12, background: '#f4c95d', color: '#0a0d14', fontSize: 24, fontWeight: 900, letterSpacing: 4 } }, code),
    h('span', { style: { display: 'flex' } }, leagueDeadline(league))),
  h('div', { style: { position: 'absolute', left: 72, top: 268, display: 'flex', gap: 14 } },
    leagueMetric('PARTICIPANTES', String(Number(league.participantCount ?? league.members ?? 0))),
    leagueMetric('CUENTAS ÚNICAS', `${Number(league.eligibleOwners || 0)}/3`),
    leagueMetric('DISPOSITIVOS', `${Number(league.eligibleDevices || 0)}/3`)),
  h('div', { style: { position: 'absolute', left: 72, top: 394, display: 'flex', flexDirection: 'column' } },
    h('span', { style: { display: 'flex', color: '#f4c95d', fontSize: 16, fontWeight: 900, letterSpacing: 2 } }, champion ? 'CAMPEÓN' : 'CLASIFICACIÓN'),
    champion
      ? h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 18 } },
        h('strong', { style: { display: 'flex', color: '#fff', fontSize: 38, fontWeight: 900 } }, truncate(champion.nick, 22)),
        h('span', { style: { display: 'flex', color: '#f4c95d', fontSize: 27, fontWeight: 900 } }, difference(champion.bestDifferenceMs)))
      : leagueLeaderboard(league)),
  h('div', { style: { position: 'absolute', right: 70, top: 284, display: 'flex', width: 330, height: 236, alignItems: 'center', justifyContent: 'center', borderRadius: 28, border: '1px solid rgba(244,201,93,.32)', background: 'radial-gradient(circle,rgba(244,201,93,.18),rgba(255,255,255,.03) 66%)' } },
    h('div', { style: { display: 'flex', width: 148, height: 148, alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: '12px solid #f4c95d', color: '#f4c95d', fontSize: 72, fontWeight: 900, boxSizing: 'border-box' } }, '106')),
  h('div', { style: { position: 'absolute', left: 72, bottom: 62, display: 'flex', color: '#fff', fontSize: 23, fontWeight: 900 } }, league.waiting === true ? 'ÚNETE PARA ACTIVAR LA COMPETICIÓN' : '¿PUEDES GANAR ESTA MINILIGA?'),
  h('div', { style: { position: 'absolute', right: 72, bottom: 62, display: 'flex', color: '#f4c95d', fontSize: 20, fontWeight: 900, letterSpacing: 2 } }, 'JUEGA EN MINUTO 106'));

  return new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
      'Content-Disposition': `inline; filename="minuto-106-liga-${encodeURIComponent(code)}.png"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS' } });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });
  }

  try {
    const route = parseRoute(request);
    if (route.kind === 'player') {
      if (route.nick.length < 2) return new Response('Jugador no válido', { status: 400 });
      const profile = await getProfile(route.nick);
      if (!profile?.nick) return new Response('Jugador no encontrado', { status: 404 });
      const nick = String(profile.nick);
      const revision = profile.profileRevision;
      const canonical = profileCanonical(nick, route.section);
      const shareUrl = profileShareUrl(request, nick, route.section, revision);
      const imageUrl = profileImageUrl(request, nick, route.section, revision);
      const trophies = Number((profile.trophies as Record<string, unknown> | undefined)?.total || 0);
      const achievements = Number((profile.achievements as Record<string, unknown> | undefined)?.total || 0);
      const title = `${nick} · Minuto 106`;
      const description = `${nick}: ${difference(profile.bestDifferenceMs)}, ${trophies} trofeos, ${achievements} logros y ${Number((profile.achievements as Record<string, unknown> | undefined)?.points || 0)} puntos.`;
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return socialHtml({
        canonical,
        description,
        imageAlt: `Tarjeta actualizada de ${nick} con estadísticas, trofeos y logros de Minuto 106.`,
        imageUrl,
        shareUrl,
        title,
        type: 'profile',
      });
    }

    if (route.kind === 'league') {
      if (!route.code) return new Response('Código de liga no válido', { status: 400 });
      const league = await getLeague(route.code);
      if (!league?.code) return new Response('Liga no encontrada', { status: 404 });
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      }
      if (route.image) return leagueCardResponse(league);

      const revision = league.revision;
      const canonical = leagueCanonical(route.code);
      const shareUrl = leagueShareUrl(request, route.code, revision);
      const imageUrl = leagueImageUrl(request, route.code, revision);
      const title = `${String(league.name || 'Miniliga')} · Minuto 106`;
      const description = league.waiting === true
        ? `La miniliga ${String(league.name || route.code)} espera 3 cuentas y 3 dispositivos únicos para comenzar.`
        : `${String(league.name || route.code)}: ${Number(league.members || 0)} participantes y ${Number(league.totalAttempts || 0)} intentos.`;
      return socialHtml({
        canonical,
        description,
        imageAlt: `Vista previa de la miniliga ${String(league.name || route.code)} de Minuto 106.`,
        imageUrl,
        shareUrl,
        title,
        type: 'website',
      });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return new Response('No se pudo generar la vista previa compartida.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
});
