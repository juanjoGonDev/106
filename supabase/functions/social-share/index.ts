import { ImageResponse } from 'npm:@vercel/og@0.11.1';
import React from 'npm:react@19.2.7';
import { createClient } from 'npm:@supabase/supabase-js@2.95.0';

const WIDTH = 1200;
const HEIGHT = 630;
const DEFAULT_SITE_URL = 'https://juanjogondev.github.io/106';
const PLAYER_SECTIONS = new Set(['overview', 'achievements', 'trophies']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const h = React.createElement;

type Data = Record<string, unknown>;
type Route =
  | { kind: 'player'; nick: string; section: string; image: false }
  | { kind: 'league' | 'duel' | 'referral'; code: string; image: boolean }
  | { kind: 'result'; id: string; image: boolean }
  | { kind: 'invalid'; image: false };

function serviceKey() {
  const direct = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (direct) return direct;
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
const key = serviceKey();
if (!supabaseUrl || !key) throw new Error('Missing Supabase function environment variables.');
const supabase = createClient(supabaseUrl, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function decoded(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeNick(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function normalizeUuid(value: unknown) {
  const id = String(value ?? '').trim().toLowerCase();
  return UUID.test(id) ? id : '';
}

function normalizeLeagueCode(value: unknown) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
}

function normalizeSection(value: unknown) {
  const section = String(value ?? '').toLowerCase();
  return PLAYER_SECTIONS.has(section) ? section : 'overview';
}

function parseRoute(request: Request): Route {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const functionIndex = parts.lastIndexOf('social-share');
  const route = functionIndex >= 0 ? parts.slice(functionIndex + 1) : [];
  const kind = route[0] ?? '';
  const image = route[2] === 'card.png' || url.searchParams.get('format') === 'png';

  if (kind === 'player') {
    return {
      kind,
      nick: normalizeNick(decoded(route[1] ?? '')),
      section: normalizeSection(route[2]),
      image: false,
    };
  }
  if (kind === 'league') return { kind, code: normalizeLeagueCode(route[1]), image };
  if (kind === 'duel' || kind === 'referral') return { kind, code: normalizeUuid(route[1]), image };
  if (kind === 'result') return { kind, id: normalizeUuid(route[1]), image };
  return { kind: 'invalid', image: false };
}

function firstHeaderValue(request: Request, name: string) {
  return request.headers.get(name)?.split(',')[0]?.trim() ?? '';
}

function publicFunctionsOrigin(request: Request) {
  const explicitOrigin = String(Deno.env.get('PUBLIC_FUNCTIONS_ORIGIN') || '').trim();
  if (explicitOrigin) return new URL(explicitOrigin).origin;

  const host = firstHeaderValue(request, 'x-forwarded-host')
    || firstHeaderValue(request, 'x-original-host')
    || firstHeaderValue(request, 'host');
  const internalHost = /^(?:supabase_edge_runtime|kong)(?::|$)/i.test(host);
  if (host && !internalHost) {
    const forwardedProtocol = firstHeaderValue(request, 'x-forwarded-proto').toLowerCase();
    const localHost = /^(?:localhost|127\.0\.0\.1)(?::|$)/i.test(host);
    const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : localHost ? 'http' : 'https';
    return `${protocol}://${host}`;
  }

  return new URL(supabaseUrl).origin;
}

function functionUrl(request: Request, functionName: string) {
  const url = new URL(publicFunctionsOrigin(request));
  url.pathname = `/functions/v1/${functionName}`;
  url.search = '';
  url.hash = '';
  return url;
}

function versioned(url: URL, revision: unknown) {
  const value = Math.max(0, Number(revision) || 0);
  url.searchParams.set('v', String(Math.trunc(value)));
  return url;
}

function socialUrl(request: Request, kind: string, id: string, revision: unknown, image = false) {
  const url = functionUrl(request, 'social-share');
  url.pathname += `/${kind}/${encodeURIComponent(id)}`;
  if (image) url.pathname += '/card.png';
  return versioned(url, revision);
}

function playerSocialUrl(request: Request, nick: string, section: string, revision: unknown) {
  const url = functionUrl(request, 'social-share');
  url.pathname += `/player/${encodeURIComponent(nick)}`;
  if (section !== 'overview') url.pathname += `/${section}`;
  return versioned(url, revision);
}

function playerImageUrl(request: Request, nick: string, section: string, revision: unknown) {
  const url = functionUrl(request, 'player-share');
  url.pathname += `/${encodeURIComponent(nick)}/${section === 'overview' ? 'card' : section}.png`;
  return versioned(url, revision);
}

function siteUrl() {
  return String(Deno.env.get('PUBLIC_SITE_URL') || DEFAULT_SITE_URL).replace(/\/$/, '');
}

function canonical(kind: string, id: string, section = 'overview') {
  if (kind === 'player') return `${siteUrl()}/player/${encodeURIComponent(id)}${section === 'overview' ? '' : `/${section}`}`;
  if (kind === 'league') return `${siteUrl()}/ligas/${encodeURIComponent(id)}`;
  if (kind === 'duel') return `${siteUrl()}/?duel=${encodeURIComponent(id)}`;
  if (kind === 'result') return `${siteUrl()}/?sharedResult=${encodeURIComponent(id)}`;
  return `${siteUrl()}/?ref=${encodeURIComponent(id)}`;
}

async function rpc(name: string, parameters: Data) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return (data ?? {}) as Data;
}

function htmlEscaped(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] as string);
}

function shortened(value: unknown, length: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

function elapsed(value: unknown) {
  return Number.isFinite(Number(value)) ? `${(Number(value) / 1000).toFixed(3)} s` : '—';
}

function difference(value: unknown) {
  return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—';
}

function dateLabel(value: unknown, prefix: string) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  return `${prefix} ${date.toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid',
  })}`;
}

function jsonResponse(data: Data) {
  return Response.json(data, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=30, s-maxage=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function metadataResponse(input: {
  canonical: string;
  description: string;
  imageAlt: string;
  imageUrl: URL;
  shareUrl: URL;
  title: string;
  type?: string;
}) {
  const type = input.type ?? 'website';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscaped(input.title)}</title><meta name="description" content="${htmlEscaped(input.description)}"><link rel="canonical" href="${htmlEscaped(input.canonical)}"><meta property="og:locale" content="es_ES"><meta property="og:type" content="${type}"><meta property="og:site_name" content="Minuto 106"><meta property="og:title" content="${htmlEscaped(input.title)}"><meta property="og:description" content="${htmlEscaped(input.description)}"><meta property="og:url" content="${htmlEscaped(input.shareUrl)}"><meta property="og:image" content="${htmlEscaped(input.imageUrl)}"><meta property="og:image:secure_url" content="${htmlEscaped(input.imageUrl)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${htmlEscaped(input.imageAlt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEscaped(input.title)}"><meta name="twitter:description" content="${htmlEscaped(input.description)}"><meta name="twitter:image" content="${htmlEscaped(input.imageUrl)}"><meta name="twitter:image:src" content="${htmlEscaped(input.imageUrl)}"><meta name="twitter:image:alt" content="${htmlEscaped(input.imageAlt)}"><meta http-equiv="refresh" content="0;url=${htmlEscaped(input.canonical)}"><script>location.replace(${JSON.stringify(input.canonical)})</script></head><body><h1>${htmlEscaped(input.title)}</h1><p>${htmlEscaped(input.description)}</p><a href="${htmlEscaped(input.canonical)}">Abrir Minuto 106</a></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=1800',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function metric(label: string, value: string, width = 250) {
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', width, minWidth: 0, height: 98,
      padding: '16px 18px', border: '1px solid rgba(255,255,255,.16)', borderRadius: 18,
      background: 'rgba(255,255,255,.06)', boxSizing: 'border-box',
    },
  },
  h('span', { style: { display: 'flex', color: '#aeb5c3', fontSize: 14, fontWeight: 700, letterSpacing: 1.3 } }, label),
  h('strong', { style: { display: 'flex', marginTop: 11, overflow: 'hidden', color: '#fff', fontSize: 28, fontWeight: 900, whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, value));
}

function card(input: {
  label: string;
  title: string;
  status: string;
  statusColor: string;
  subtitle: string;
  metrics: Array<{ label: string; value: string; width?: number }>;
  detail: string;
  cta: string;
}) {
  return h('div', {
    style: {
      position: 'relative', display: 'flex', width: WIDTH, height: HEIGHT, overflow: 'hidden',
      background: 'linear-gradient(118deg,#650018 0%,#090b12 48%,#123b6b 100%)',
      color: '#fff', fontFamily: 'Arial, sans-serif',
    },
  },
  h('div', { style: { position: 'absolute', inset: 32, display: 'flex', border: '1px solid rgba(255,255,255,.16)', borderRadius: 30, background: 'rgba(5,8,14,.86)' } }),
  h('div', { style: { position: 'absolute', top: 62, left: 72, display: 'flex', color: '#f4c95d', fontSize: 18, fontWeight: 900, letterSpacing: 4 } }, input.label),
  h('div', { style: { position: 'absolute', top: 58, right: 72, display: 'flex', padding: '11px 17px', border: `2px solid ${input.statusColor}`, borderRadius: 999, color: input.statusColor, fontSize: 17, fontWeight: 900, letterSpacing: 2 } }, input.status),
  h('div', { style: { position: 'absolute', top: 116, left: 72, display: 'flex', width: 900, height: 68, overflow: 'hidden', color: '#fff', fontSize: input.title.length > 28 ? 48 : 58, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, input.title),
  h('div', { style: { position: 'absolute', top: 205, left: 72, display: 'flex', width: 940, color: '#d5dae3', fontSize: 23, fontWeight: 700 } }, input.subtitle),
  h('div', { style: { position: 'absolute', top: 285, left: 72, display: 'flex', gap: 14 } },
    ...input.metrics.map((item) => metric(item.label, item.value, item.width))),
  h('div', { style: { position: 'absolute', top: 420, left: 72, display: 'flex', width: 930, color: '#aeb5c3', fontSize: 21, fontWeight: 700 } }, input.detail),
  h('div', { style: { position: 'absolute', bottom: 55, left: 72, display: 'flex', color: '#fff', fontSize: 24, fontWeight: 900 } }, input.cta),
  h('div', { style: { position: 'absolute', right: 72, bottom: 55, display: 'flex', color: '#f4c95d', fontSize: 20, fontWeight: 900, letterSpacing: 2 } }, 'JUEGA EN MINUTO 106'));
}

function pngResponse(element: ReturnType<typeof h>, filename: string) {
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

function leagueCard(data: Data) {
  const waiting = data.waiting === true;
  const active = data.active === true;
  const publicId = String(data.publicId || data.code || '');
  return pngResponse(card({
    label: 'MINUTO 106 · MINILIGA',
    title: shortened(data.name || 'Miniliga', 38),
    status: waiting ? 'EN ESPERA' : active ? 'EN JUEGO' : 'FINALIZADA',
    statusColor: waiting ? '#f4c95d' : active ? '#68d391' : '#9ca3af',
    subtitle: waiting ? 'Empieza con 3 cuentas y 3 dispositivos únicos.' : `Liga pública ${publicId}`,
    metrics: [
      { label: 'PARTICIPANTES', value: String(Number(data.participantCount ?? data.members ?? 0)), width: 220 },
      { label: 'CUENTAS ÚNICAS', value: `${Number(data.eligibleOwners || 0)}/3`, width: 220 },
      { label: 'DISPOSITIVOS', value: `${Number(data.eligibleDevices || 0)}/3`, width: 220 },
    ],
    detail: waiting ? 'La cuenta atrás de tres días todavía no ha comenzado.' : dateLabel(data.endsAt, data.finished === true ? 'Finalizó' : 'Termina'),
    cta: waiting ? 'ÚNETE PARA ACTIVAR LA COMPETICIÓN' : '¿PUEDES GANAR ESTA MINILIGA?',
  }), `minuto-106-liga-${publicId}.png`);
}

function duelCard(data: Data) {
  const open = data.open === true;
  return pngResponse(card({
    label: 'MINUTO 106 · RETO DIRECTO',
    title: `${shortened(data.challengerNick || 'Un jugador', 22)} te reta`,
    status: open ? 'RETO ABIERTO' : String(data.status || 'CERRADO').toUpperCase(),
    statusColor: open ? '#68d391' : '#9ca3af',
    subtitle: 'Supera esta marca verificada para ganar 3 intentos extra.',
    metrics: [
      { label: 'TIEMPO A BATIR', value: elapsed(data.targetElapsedMs), width: 280 },
      { label: 'DIFERENCIA', value: difference(data.targetDifferenceMs), width: 250 },
      { label: 'SELECCIÓN', value: data.challengerTeam === 'spain' ? 'España' : data.challengerTeam === 'argentina' ? 'Argentina' : 'Global', width: 220 },
    ],
    detail: dateLabel(data.expiresAt, 'Disponible hasta'),
    cta: open ? 'ACEPTA EL RETO Y DEMUESTRA TU PRECISIÓN' : 'CONSULTA EL RESULTADO DEL DUELO',
  }), `minuto-106-reto-${data.code}.png`);
}

function resultCard(data: Data) {
  const competition = data.competitionType === 'league' ? shortened(data.leagueName || 'Miniliga', 26) : 'Ranking global';
  return pngResponse(card({
    label: 'MINUTO 106 · RESULTADO',
    title: shortened(data.nick || 'Jugador', 32),
    status: data.verified === true ? 'VERIFICADO' : 'EXCLUIDO',
    statusColor: data.verified === true ? '#68d391' : '#ff8791',
    subtitle: data.team === 'spain' ? 'España' : 'Argentina',
    metrics: [
      { label: 'TIEMPO', value: elapsed(data.elapsedMs), width: 280 },
      { label: 'DEL 10.600', value: difference(data.differenceMs), width: 250 },
      { label: 'COMPETICIÓN', value: competition, width: 300 },
    ],
    detail: dateLabel(data.createdAt, 'Registrado'),
    cta: '¿PUEDES ACERCARTE MÁS AL 10.600?',
  }), `minuto-106-resultado-${data.id}.png`);
}

function referralCard(data: Data) {
  return pngResponse(card({
    label: 'MINUTO 106 · INVITACIÓN',
    title: `${shortened(data.nick || 'Un jugador', 22)} te invita`,
    status: '5 INTENTOS',
    statusColor: '#f4c95d',
    subtitle: 'Completa tus cinco intentos válidos y ambos ganaréis un intento extra.',
    metrics: [
      { label: 'MEJOR MARCA', value: difference(data.bestDifferenceMs), width: 300 },
      { label: 'SELECCIÓN', value: data.team === 'spain' ? 'España' : data.team === 'argentina' ? 'Argentina' : 'Sin elegir', width: 260 },
    ],
    detail: 'Tu precisión también suma puntos para España o Argentina.',
    cta: 'ENTRA, JUEGA Y SUPERA A TU RIVAL',
  }), `minuto-106-invitacion-${data.referralCode}.png`);
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
    const route = parseRoute(request);
    const wantsJson = new URL(request.url).searchParams.get('format') === 'json';

    if (route.kind === 'player') {
      if (route.nick.length < 2) return new Response('Jugador no válido', { status: 400 });
      const data = await rpc('get_game_public_profile', { p_nick_key: route.nick.toLocaleLowerCase('es') });
      if (!data.nick) return new Response('Jugador no encontrado', { status: 404 });
      if (wantsJson) return jsonResponse(data);
      const nick = String(data.nick);
      const revision = data.profileRevision;
      const share = playerSocialUrl(request, nick, route.section, revision);
      const image = playerImageUrl(request, nick, route.section, revision);
      const trophies = Number((data.trophies as Data | undefined)?.total || 0);
      const achievements = Number((data.achievements as Data | undefined)?.total || 0);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return metadataResponse({
        canonical: canonical('player', nick, route.section),
        title: `${nick} · Minuto 106`,
        description: `${nick}: ${difference(data.bestDifferenceMs)}, ${trophies} trofeos y ${achievements} logros.`,
        shareUrl: share,
        imageUrl: image,
        imageAlt: `Tarjeta actualizada de ${nick} en Minuto 106.`,
        type: 'profile',
      });
    }

    if (route.kind === 'league') {
      if (!route.code) return new Response('Identificador público de liga no válido', { status: 400 });
      const data = await rpc('get_game_league', { p_code: route.code });
      const publicId = String(data.publicId || data.code || '');
      if (!publicId) return new Response('Liga no encontrada', { status: 404 });
      if (wantsJson) return jsonResponse(data);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return leagueCard(data);
      const revision = data.revision;
      return metadataResponse({
        canonical: canonical('league', publicId),
        title: `${data.name || 'Miniliga'} · Minuto 106`,
        description: data.waiting === true
          ? `${data.name || publicId} espera tres cuentas y tres dispositivos únicos para comenzar.`
          : `${data.name || publicId}: ${Number(data.members || 0)} participantes y ${Number(data.totalAttempts || 0)} intentos.`,
        shareUrl: socialUrl(request, 'league', publicId, revision),
        imageUrl: socialUrl(request, 'league', publicId, revision, true),
        imageAlt: `Vista previa de la miniliga ${data.name || publicId}.`,
      });
    }

    if (route.kind === 'duel') {
      if (!route.code) return new Response('Código de reto no válido', { status: 400 });
      const data = await rpc('get_game_public_duel', { p_code: route.code });
      if (!data.code) return new Response('Reto no encontrado', { status: 404 });
      if (wantsJson) return jsonResponse(data);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return duelCard(data);
      const revision = data.revision;
      const challenger = String(data.challengerNick || 'Un jugador');
      return metadataResponse({
        canonical: canonical('duel', route.code),
        title: `${challenger} te reta · Minuto 106`,
        description: `${challenger} te reta a superar ${elapsed(data.targetElapsedMs)} (${difference(data.targetDifferenceMs)} del 10.600).`,
        shareUrl: socialUrl(request, 'duel', route.code, revision),
        imageUrl: socialUrl(request, 'duel', route.code, revision, true),
        imageAlt: `Reto de ${challenger} con un tiempo a batir de ${elapsed(data.targetElapsedMs)}.`,
      });
    }

    if (route.kind === 'result') {
      if (!route.id) return new Response('Resultado no válido', { status: 400 });
      const data = await rpc('get_game_public_attempt', { p_attempt_id: route.id });
      if (!data.id) return new Response('Resultado no encontrado', { status: 404 });
      if (wantsJson) return jsonResponse(data);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return resultCard(data);
      const revision = data.revision;
      const nick = String(data.nick || 'Jugador');
      return metadataResponse({
        canonical: canonical('result', route.id),
        title: `${nick}: ${elapsed(data.elapsedMs)} · Minuto 106`,
        description: `${nick} registró ${elapsed(data.elapsedMs)} y quedó a ${Number(data.differenceMs).toLocaleString('es-ES')} ms del 10.600.`,
        shareUrl: socialUrl(request, 'result', route.id, revision),
        imageUrl: socialUrl(request, 'result', route.id, revision, true),
        imageAlt: `Resultado de ${nick}: ${elapsed(data.elapsedMs)}, ${difference(data.differenceMs)}.`,
      });
    }

    if (route.kind === 'referral') {
      if (!route.code) return new Response('Invitación no válida', { status: 400 });
      const data = await rpc('get_game_public_referral', { p_referral_code: route.code });
      if (!data.referralCode) return new Response('Invitación no encontrada', { status: 404 });
      if (wantsJson) return jsonResponse(data);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Type': route.image ? 'image/png' : 'text/html; charset=utf-8' } });
      if (route.image) return referralCard(data);
      const revision = data.profileRevision;
      const nick = String(data.nick || 'Un jugador');
      return metadataResponse({
        canonical: canonical('referral', route.code),
        title: `${nick} te invita · Minuto 106`,
        description: `${nick} te invita a jugar. Completa cinco intentos válidos y ambos ganaréis un intento extra.`,
        shareUrl: socialUrl(request, 'referral', route.code, revision),
        imageUrl: socialUrl(request, 'referral', route.code, revision, true),
        imageAlt: `Invitación de ${nick} para jugar a Minuto 106.`,
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
