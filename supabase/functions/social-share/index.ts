import { ImageResponse } from 'npm:@vercel/og@0.11.1';
import React from 'npm:react@19.2.7';
import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const WIDTH = 1200;
const HEIGHT = 630;
const DEFAULT_SITE_URL = 'https://juanjogondev.github.io/106';
const PLAYER_SECTIONS = new Set(['overview', 'achievements', 'trophies']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const h = React.createElement;

type ShareRoute =
  | { kind: 'player'; nick: string; section: string; image: false }
  | { kind: 'league'; code: string; image: boolean }
  | { kind: 'duel'; code: string; image: boolean }
  | { kind: 'result'; id: string; image: boolean }
  | { kind: 'referral'; code: string; image: boolean }
  | { kind: 'invalid'; image: false };

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
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

function normalizeUuid(value: unknown) {
  const code = String(value ?? '').trim().toLowerCase();
  return UUID.test(code) ? code : '';
}

function normalizeSection(value: unknown) {
  const section = String(value ?? '').toLowerCase();
  return PLAYER_SECTIONS.has(section) ? section : 'overview';
}

function routeUsesImage(route: string[], url: URL) {
  return String(route[2] ?? '').toLowerCase() === 'card.png' || url.searchParams.get('format') === 'png';
}

function parseRoute(request: Request): ShareRoute {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('social-share');
  const route = functionIndex >= 0 ? parts.slice(functionIndex + 1) : [];
  const kind = route[0] ?? '';

  if (kind === 'player') {
    return {
      kind: 'player',
      nick: normalizeNick(decodeRouteValue(route[1] ?? '')),
      section: normalizeSection(route[2]),
      image: false,
    };
  }
  if (kind === 'league') return { kind, code: normalizeLeagueCode(route[1]), image: routeUsesImage(route, url) };
  if (kind === 'duel') return { kind, code: normalizeUuid(route[1]), image: routeUsesImage(route, url) };
  if (kind === 'result') return { kind, id: normalizeUuid(route[1]), image: routeUsesImage(route, url) };
  if (kind === 'referral') return { kind, code: normalizeUuid(route[1]), image: routeUsesImage(route, url) };
  return { kind: 'invalid', image: false };
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

function socialRouteUrl(request: Request, kind: string, id: string, revision: unknown, image = false) {
  const url = functionBaseUrl(request, 'social-share');
  url.pathname += `/${kind}/${encodeURIComponent(id)}`;
  if (image) url.pathname += '/card.png';
  return versioned(url, revision);
}

function siteBaseUrl() {
  return String(Deno.env.get('PUBLIC_SITE_URL') || DEFAULT_SITE_URL).replace(/\/$/, '');
}

function profileCanonical(nick: string, section: string) {
  const suffix = section === 'overview' ? '' : `/${section}`;
  return `${siteBaseUrl()}/player/${encodeURIComponent(nick)}${suffix}`;
}

function profileImageUrl(request: Request, nick: string, section: string, revision: unknown) {
  const url = functionBaseUrl(request, 'player-share');
  const imageName = section === 'overview' ? 'card' : section;
  url.pathname += `/${encodeURIComponent(nick)}/${imageName}.png`;
  return versioned(url, revision);
}

function leagueCanonical(code: string) {
  return `${siteBaseUrl()}/ligas.html?league=${encodeURIComponent(code)}`;
}

function duelCanonical(code: string) {
  return `${siteBaseUrl()}/?duel=${encodeURIComponent(code)}`;
}

function resultCanonical(id: string) {
  return `${siteBaseUrl()}/?sharedResult=${encodeURIComponent(id)}`;
}

function referralCanonical(code: string) {
  return `${siteBaseUrl()}/?ref=${encodeURIComponent(code)}`;
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw new Error(`${name} failed`);
  return (data ?? {}) as Record<string, unknown>;
}

const getProfile = (nick: string) => rpc('get_game_public_profile', { p_nick_key: nick.toLocaleLowerCase('es') });
const getLeague = (code: string) => rpc('get_game_league', { p_code: code });
const getDuel = (code: string) => rpc('get_game_public_duel', { p_code: code });
const getAttempt = (id: string) => rpc('get_game_public_attempt', { p_attempt_id: id });
const getReferral = (code: string) => rpc('get_game_public_referral', { p_referral_code: code });

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] as string);
}

function truncate(value: unknown, maximum: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function milliseconds(value: unknown) {
  return Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('es-ES')} ms` : '—';
}

function difference(value: unknown) {
  return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : 'Sin marca';
}

function elapsed(value: unknown) {
  return Number.isFinite(Number(value)) ? `${(Number(value) / 1000).toFixed(3)} s` : '—';
}

function formatDate(value: unknown, prefix: string) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  return `${prefix} ${date.toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid',
  })}`;
}

function jsonResponse(data: Record<string, unknown>) {
  return Response.json(data, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=30, s-maxage=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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
  type = 'website',
}: {
  canonical: string;
  description: string;
  imageAlt: string;
  imageUrl: URL;
  shareUrl: URL;
  title: string;
  type?: string;
}) {
  return htmlResponse(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:locale" content="es_ES"><meta property="og:type" content="${escapeHtml(type)}"><meta property="og:site_name" content="Minuto 106"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl.toString())}"><meta property="og:image" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:secure_url" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(imageAlt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}"><meta name="twitter:image:src" content="${escapeHtml(imageUrl.toString())}"><meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}"><meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}"><script>location.replace(${JSON.stringify(canonical)})</script></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p><a href="${escapeHtml(canonical)}">Abrir Minuto 106</a></p></main></body></html>`);
}

function cardShell(label: string, title: string, status: string, statusColor: string, children: React.ReactNode[]) {
  return h('div', {
    style: {
      position: 'relative', display: 'flex', width: WIDTH, height: HEIGHT, overflow: 'hidden', color: '#fff',
      fontFamily: 'Arial, sans-serif', background: 'linear-gradient(118deg,#650018 0%,#090b12 48%,#123b6b 100%)',
    },
  },
  h('div', { style: { position: 'absolute', inset: 32, display: 'flex', border: '1px solid rgba(255,255,255,.16)', borderRadius: 30, background: 'rgba(5,8,14,.86)' } }),
  h('div', { style: { position: 'absolute', left: 72, top: 62, display: 'flex', color: '#f4c95d', fontSize: 18, fontWeight: 900, letterSpacing: 4 } }, label),
  h('div', { style: { position: 'absolute', right: 72, top: 58, display: 'flex', padding: '11px 17px', border: `2px solid ${statusColor}`, borderRadius: 999, color: statusColor, fontSize: 17, fontWeight: 900, letterSpacing: 2 } }, status),
  h('div', { style: { position: 'absolute', left: 72, top: 112, display: 'flex', width: 870, height: 76, overflow: 'hidden', color: '#fff', fontSize: title.length > 28 ? 48 : 58, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, title),
  ...children,
  h('div', { style: { position: 'absolute', right: 72, bottom: 55, display: 'flex', color: '#f4c95d', fontSize: 20, fontWeight: 900, letterSpacing: 2 } }, 'JUEGA EN MINUTO 106'));
}

function metric(label: string, value: string, width = 220) {
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', width, minWidth: 0, height: 92, padding: '16px 18px',
      border: '1px solid rgba(255,255,255,.16)', borderRadius: 18, background: 'rgba(255,255,255,.06)', boxSizing: 'border-box',
    },
  },
  h('span', { style: { display: 'flex', color: '#aeb5c3', fontSize: 14, fontWeight: 700, letterSpacing: 1.4 } }, label),
  h('strong', { style: { display: 'flex', color: '#fff', fontSize: 28, fontWeight: 900, marginTop: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, value));
}

function imageResponse(element: React.ReactElement, filename: string) {
  return new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
      'Content-Disposition': `inline; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function leagueCard(league: Record<string, unknown>) {
  const waiting = league.waiting === true;
  const active = league.active === true;
  const status = waiting ? 'EN ESPERA' : active ? 'EN JUEGO' : 'FINALIZADA';
  const statusColor = waiting ? '#f4c95d' : active ? '#68d391' : '#9ca3af';
  const champion = league.champion as Record<string, unknown> | null;
  const title = truncate(league.name || 'Miniliga', 38);
  return imageResponse(cardShell('MINUTO 106 · MINILIGA', title, status, statusColor, [
    h('div', { key: 'code', style: { position: 'absolute', left: 74, top: 202, display: 'flex', padding: '10px 16px', borderRadius: 12, background: '#f4c95d', color: '#0a0d14', fontSize: 24, fontWeight: 900, letterSpacing: 4 } }, String(league.code || '------')),
    h('div', { key: 'deadline', style: { position: 'absolute', left: 245, top: 214, display: 'flex', color: '#d5dae3', fontSize: 21, fontWeight: 700 } }, waiting ? 'Empieza con 3 cuentas y 3 dispositivos únicos' : formatDate(league.endsAt, league.finished === true ? 'Finalizó' : 'Termina')),
    h('div', { key: 'metrics', style: { position: 'absolute', left: 72, top: 280, display: 'flex', gap: 14 } },
      metric('PARTICIPANTES', String(Number(league.participantCount ?? league.members ?? 0))),
      metric('CUENTAS ÚNICAS', `${Number(league.eligibleOwners || 0)}/3`),
      metric('DISPOSITIVOS', `${Number(league.eligibleDevices || 0)}/3`)),
    h('div', { key: 'summary', style: { position: 'absolute', left: 72, top: 410, display: 'flex', flexDirection: 'column' } },
      h('span', { style: { display: 'flex', color: '#f4c95d', fontSize: 16, fontWeight: 900, letterSpacing: 2 } }, champion ? 'CAMPEÓN' : 'ESTADO'),
      h('strong', { style: { display: 'flex', color: '#fff', fontSize: 38, fontWeight: 900, marginTop: 16 } }, champion ? truncate(champion.nick, 22) : waiting ? 'Falta 1 rival válido' : `${Number(league.totalAttempts || 0)} intentos`),
      champion ? h('span', { style: { display: 'flex', color: '#f4c95d', fontSize: 27, fontWeight: 900, marginTop: 8 } }, difference(champion.bestDifferenceMs)) : null),
    h('div', { key: 'cta', style: { position: 'absolute', left: 72, bottom: 55, display: 'flex', color: '#fff', fontSize: 23, fontWeight: 900 } }, waiting ? 'ÚNETE PARA ACTIVAR LA COMPETICIÓN' : '¿PUEDES GANAR ESTA MINILIGA?'),
  ]), `minuto-106-liga-${String(league.code)}.png`);
}

function duelCard(duel: Record<string, unknown>) {
  const open = duel.open === true;
  const status = open ? 'RETO ABIERTO' : String(duel.status || 'CERRADO').toUpperCase();
  const statusColor = open ? '#68d391' : '#9ca3af';
  const title = `${truncate(duel.challengerNick || 'Un jugador', 22)} te reta`;
  return imageResponse(cardShell('MINUTO 106 · RETO DIRECTO', title, status, statusColor, [
    h('div', { key: 'copy', style: { position: 'absolute', left: 72, top: 205, display: 'flex', color: '#d5dae3', fontSize: 23, fontWeight: 700 } }, 'Supera esta marca verificada para ganar 3 intentos extra.'),
    h('div', { key: 'metrics', style: { position: 'absolute', left: 72, top: 278, display: 'flex', gap: 14 } },
      metric('TIEMPO A BATIR', elapsed(duel.targetElapsedMs), 270),
      metric('DIFERENCIA', difference(duel.targetDifferenceMs), 235),
      metric('SELECCIÓN', duel.challengerTeam === 'spain' ? 'España' : duel.challengerTeam === 'argentina' ? 'Argentina' : 'Global', 210)),
    h('div', { key: 'deadline', style: { position: 'absolute', left: 72, top: 405, display: 'flex', color: '#aeb5c3', fontSize: 20, fontWeight: 700 } }, formatDate(duel.expiresAt, 'Disponible hasta')),
    h('div', { key: 'cta', style: { position: 'absolute', left: 72, bottom: 55, display: 'flex', color: '#fff', fontSize: 25, fontWeight: 900 } }, open ? 'ACEPTA EL RETO Y DEMUESTRA TU PRECISIÓN' : 'CONSULTA EL RESULTADO DEL DUELO'),
  ]), `minuto-106-reto-${String(duel.code)}.png`);
}

function resultCard(attempt: Record<string, unknown>) {
  const verified = attempt.verified === true;
  const status = verified ? 'VERIFICADO' : 'EXCLUIDO';
  const statusColor = verified ? '#68d391' : '#ff8791';
  const competition = attempt.competitionType === 'league' ? truncate(attempt.leagueName || 'Miniliga', 28) : 'Ranking global';
  return imageResponse(cardShell('MINUTO 106 · RESULTADO', truncate(attempt.nick || 'Jugador', 32), status, statusColor, [
    h('div', { key: 'team', style: { position: 'absolute', left: 72, top: 205, display: 'flex', color: '#d5dae3', fontSize: 23, fontWeight: 700 } }, attempt.team === 'spain' ? 'España' : 'Argentina'),
    h('div', { key: 'metrics', style: { position: 'absolute', left: 72, top: 278, display: 'flex', gap: 14 } },
      metric('TIEMPO', elapsed(attempt.elapsedMs), 270),
      metric('DEL 10.600', difference(attempt.differenceMs), 250),
      metric('COMPETICIÓN', competition, 300)),
    h('div', { key: 'created', style: { position: 'absolute', left: 72, top: 405, display: 'flex', color: '#aeb5c3', fontSize: 20, fontWeight: 700 } }, formatDate(attempt.createdAt, 'Registrado')),
    h('div', { key: 'cta', style: { position: 'absolute', left: 72, bottom: 55, display: 'flex', color: '#fff', fontSize: 25, fontWeight: 900 } }, '¿PUEDES ACERCARTE MÁS AL 10.600?'),
  ]), `minuto-106-resultado-${String(attempt.id)}.png`);
}

function referralCard(referral: Record<string, unknown>) {
  const title = `${truncate(referral.nick || 'Un jugador', 22)} te invita`;
  return imageResponse(cardShell('MINUTO 106 · INVITACIÓN', title, '5 INTENTOS', '#f4c95d', [
    h('div', { key: 'copy', style: { position: 'absolute', left: 72, top: 205, display: 'flex', width: 780, color: '#d5dae3', fontSize: 23, fontWeight: 700 } }, 'Completa tus cinco intentos válidos y ambos ganaréis un intento extra.'),
    h('div', { key: 'metrics', style: { position: 'absolute', left: 72, top: 292, display: 'flex', gap: 14 } },
      metric('MEJOR MARCA', difference(referral.bestDifferenceMs), 280),
      metric('SELECCIÓN', referral.team === 'spain' ? 'España' : referral.team === 'argentina' ? 'Argentina' : 'Sin elegir', 250)),
    h('div', { key: 'cta', style: { position: 'absolute', left: 72, bottom: 55, display: 'flex', color: '#fff', fontSize: 25, fontWeight: 900 } }, 'ENTRA, JUEGA Y SUPERA A TU RIVAL'),
  ]), `minuto-106-invitacion-${String(referral.referralCode)}.png`);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      },
    });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });
  }

  try {
    const url = new URL(request.url);
    const route = parseRoute(request);
    const wantsJson = url.searchParams.get('format') === 'json';

    if (route.kind === 'player') {
      if (route.nick.length < 2) return new Response('Jugador no válido', { status: 400 });
      const profile = await getProfile(route.nick);
      if (!profile?.nick) return new Response('Jugador no encontrado', { status: 404 });
      if (wantsJson) return jsonResponse(profile);
      const nick = String(profile.nick);
      const revision = profile.profileRevision;
      const canonical = profileCanonical(nick, route.section);
      const shareUrl = socialRouteUrl(request, 'player', `${nick}${route.section === 'overview' ? '' : `/${route.section}`}`, revision);
      const imageUrl = profileImageUrl(request, nick, route.section, revision);
      const trophies = Number((profile.trophies as Record<string, unknown> | undefined)?.total || 0);
      const achievements = Number((profile.achievements as Record<string, unknown> | undefined)?.total || 0);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return socialHtml({
        canonical,
        description: `${nick}: ${difference(profile.bestDifferenceMs)}, ${trophies} trofeos y ${achievements} logros.`,
        imageAlt: `Tarjeta actualizada de ${nick} con estadísticas, trofeos y logros de Minuto 106.`,
        imageUrl,
        shareUrl,
        title: `${nick} · Minuto 106`,
        type: 'profile',
      });
    }

    if (route.kind === 'league') {
      if (!route.code) return new Response('Código de liga no válido', { status: 400 });
      const league = await getLeague(route.code);
      if (!league?.code) return new Response('Liga no encontrada', { status: 404 });
      if (wantsJson) return jsonResponse(league);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return leagueCard(league);
      const revision = league.revision;
      return socialHtml({
        canonical: leagueCanonical(route.code),
        description: league.waiting === true
          ? `La miniliga ${String(league.name || route.code)} espera 3 cuentas y 3 dispositivos únicos para comenzar.`
          : `${String(league.name || route.code)}: ${Number(league.members || 0)} participantes y ${Number(league.totalAttempts || 0)} intentos.`,
        imageAlt: `Vista previa de la miniliga ${String(league.name || route.code)} de Minuto 106.`,
        imageUrl: socialRouteUrl(request, 'league', route.code, revision, true),
        shareUrl: socialRouteUrl(request, 'league', route.code, revision),
        title: `${String(league.name || 'Miniliga')} · Minuto 106`,
      });
    }

    if (route.kind === 'duel') {
      if (!route.code) return new Response('Código de reto no válido', { status: 400 });
      const duel = await getDuel(route.code);
      if (!duel?.code) return new Response('Reto no encontrado', { status: 404 });
      if (wantsJson) return jsonResponse(duel);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return duelCard(duel);
      const revision = duel.revision;
      const challenger = String(duel.challengerNick || 'Un jugador');
      return socialHtml({
        canonical: duelCanonical(route.code),
        description: `${challenger} te reta a superar ${elapsed(duel.targetElapsedMs)} (${difference(duel.targetDifferenceMs)} del 10.600).`,
        imageAlt: `Reto directo de ${challenger} con un tiempo a batir de ${elapsed(duel.targetElapsedMs)}.`,
        imageUrl: socialRouteUrl(request, 'duel', route.code, revision, true),
        shareUrl: socialRouteUrl(request, 'duel', route.code, revision),
        title: `${challenger} te reta · Minuto 106`,
      });
    }

    if (route.kind === 'result') {
      if (!route.id) return new Response('Resultado no válido', { status: 400 });
      const attempt = await getAttempt(route.id);
      if (!attempt?.id) return new Response('Resultado no encontrado', { status: 404 });
      if (wantsJson) return jsonResponse(attempt);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return resultCard(attempt);
      const revision = attempt.revision;
      const nick = String(attempt.nick || 'Jugador');
      return socialHtml({
        canonical: resultCanonical(route.id),
        description: `${nick} registró ${elapsed(attempt.elapsedMs)} y quedó a ${milliseconds(attempt.differenceMs)} del 10.600.`,
        imageAlt: `Resultado de ${nick}: ${elapsed(attempt.elapsedMs)}, ${difference(attempt.differenceMs)} del objetivo.`,
        imageUrl: socialRouteUrl(request, 'result', route.id, revision, true),
        shareUrl: socialRouteUrl(request, 'result', route.id, revision),
        title: `${nick}: ${elapsed(attempt.elapsedMs)} · Minuto 106`,
      });
    }

    if (route.kind === 'referral') {
      if (!route.code) return new Response('Invitación no válida', { status: 400 });
      const referral = await getReferral(route.code);
      if (!referral?.referralCode) return new Response('Invitación no encontrada', { status: 404 });
      if (wantsJson) return jsonResponse(referral);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return referralCard(referral);
      const revision = referral.profileRevision;
      const nick = String(referral.nick || 'Un jugador');
      return socialHtml({
        canonical: referralCanonical(route.code),
        description: `${nick} te invita a jugar. Completa cinco intentos válidos y ambos ganaréis un intento extra.`,
        imageAlt: `Invitación de ${nick} para jugar a Minuto 106.`,
        imageUrl: socialRouteUrl(request, 'referral', route.code, revision, true),
        shareUrl: socialRouteUrl(request, 'referral', route.code, revision),
        title: `${nick} te invita · Minuto 106`,
      });
    }

    return new Response('Ruta no encontrada', { status: 404 });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return new Response('No se pudo generar la vista previa compartida.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});
