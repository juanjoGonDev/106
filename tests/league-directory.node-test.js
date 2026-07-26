import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

await import(`${pathToFileURL('public/league-directory.js').href}?test=${Date.now()}`);
const directory = globalThis.Minuto106LeagueDirectory;

function league(overrides = {}) {
  return {
    publicId: 'ABC123',
    visibility: 'public',
    participantCount: 3,
    maxParticipants: 10,
    durationDays: 3,
    ...overrides,
  };
}

test('normalizes public identifiers, filters and creation settings', () => {
  assert.equal(directory.normalizeLeagueId(' abc123 '), 'ABC123');
  assert.equal(directory.normalizeLeagueId('abc'), '');
  assert.equal(directory.normalizeLeagueId(null), '');

  assert.equal(directory.normalizeVisibilityFilter('PUBLIC'), 'public');
  assert.equal(directory.normalizeVisibilityFilter('private'), 'private');
  assert.equal(directory.normalizeVisibilityFilter('all'), 'all');
  assert.equal(directory.normalizeVisibilityFilter('other'), 'all');
  assert.equal(directory.normalizeVisibilityFilter(null), 'all');

  assert.equal(directory.normalizeLeagueVisibility('PUBLIC'), 'public');
  assert.equal(directory.normalizeLeagueVisibility('private'), 'private');
  assert.equal(directory.normalizeLeagueVisibility('other'), 'private');

  assert.equal(directory.normalizeDurationDays(1), 1);
  assert.equal(directory.normalizeDurationDays(7), 7);
  assert.equal(directory.normalizeDurationDays(0), 3);
  assert.equal(directory.normalizeDurationDays(8), 3);
  assert.equal(directory.normalizeDurationDays(2.5), 3);

  assert.equal(directory.normalizeMaxParticipants(10), 10);
  assert.equal(directory.normalizeMaxParticipants(100), 100);
  assert.equal(directory.normalizeMaxParticipants(0), 10);
  assert.equal(directory.normalizeMaxParticipants(110), 10);
  assert.equal(directory.normalizeMaxParticipants(15), 10);
  assert.equal(directory.normalizeMaxParticipants(20.5), 10);
});

test('derives every lifecycle phase and countdown label deterministically', () => {
  const now = Date.parse('2026-07-26T12:00:00.000Z');
  assert.equal(directory.leaguePhase(league({ finished: true }), now), 'finished');
  assert.equal(directory.leaguePhase(league({ endsAt: '2026-07-26T11:59:59.000Z' }), now), 'finished');
  assert.equal(directory.leaguePhase(league({ active: true }), now), 'active');
  assert.equal(directory.leaguePhase(league({ startsAt: '2026-07-26T11:00:00.000Z', endsAt: '2026-07-26T13:00:00.000Z' }), now), 'active');
  assert.equal(directory.leaguePhase(league({ startsAt: '2026-07-26T11:00:00.000Z', endsAt: null }), now), 'active');
  assert.equal(directory.leaguePhase(league({ scheduled: true }), now), 'scheduled');
  assert.equal(directory.leaguePhase(league({ startsAt: '2026-07-26T13:00:00.000Z' }), now), 'scheduled');
  assert.equal(directory.leaguePhase(league(), now), 'waiting');

  assert.equal(directory.formatCountdown(172_800_000), '2 d 0 h');
  assert.equal(directory.formatCountdown(7_260_000), '2 h 1 min');
  assert.equal(directory.formatCountdown(125_000), '2 min 5 s');
  assert.equal(directory.formatCountdown(5_000), '5 s');
  assert.equal(directory.formatCountdown(-1), '0 s');

  assert.equal(directory.leagueStatusLabel(league({ finished: true }), now), 'Finalizada');
  assert.equal(directory.leagueStatusLabel(league({ active: true, endsAt: '2026-07-26T14:00:00.000Z' }), now), 'Termina en 2 h 0 min');
  assert.equal(directory.leagueStatusLabel(league({ active: true, endsAt: 'invalid' }), now), 'En juego');
  assert.equal(directory.leagueStatusLabel(league({ active: true, endsAt: undefined }), now), 'En juego');
  assert.equal(directory.leagueStatusLabel(league({ scheduled: true, startsAt: '2026-07-27T12:00:00.000Z' }), now), 'Empieza en 1 d 0 h');
  assert.equal(directory.leagueStatusLabel(league({ scheduled: true, startsAt: 'invalid' }), now), 'Inicio programado');
  assert.equal(directory.leagueStatusLabel(league({ scheduled: true, startsAt: undefined }), now), 'Inicio programado');
  assert.equal(directory.leagueStatusLabel(league({ participantCount: 2, requiredParticipants: 3 }), now), 'Esperando 1 participante');
  assert.equal(directory.leagueStatusLabel(league({ participantCount: 1, requiredParticipants: 3 }), now), 'Esperando 2 participantes');
  assert.equal(directory.leagueStatusLabel(league({ members: 3, participantCount: undefined, requiredParticipants: undefined }), now), 'Esperando 0 participantes');
  assert.equal(directory.leagueStatusLabel(league({ members: undefined, participantCount: undefined }), now), 'Esperando 3 participantes');
});

test('builds safe payloads and gates public joining and active play', () => {
  assert.deepEqual(directory.buildDirectoryPayload('  copa  ', 'public'), {
    action: 'list-leagues',
    search: 'copa',
    visibility: 'public',
  });
  assert.equal(directory.buildDirectoryPayload('x'.repeat(100), 'bad').search.length, 80);
  assert.equal(directory.buildDirectoryPayload(null, null).search, '');

  assert.deepEqual(directory.buildCreatePayload({
    nick: ' Juanjo ',
    name: ' Copa ',
    visibility: 'public',
    durationDays: 7,
    maxParticipants: 100,
  }), {
    action: 'create-league',
    nick: 'Juanjo',
    name: 'Copa',
    visibility: 'public',
    durationDays: 7,
    maxParticipants: 100,
  });
  assert.deepEqual(directory.buildCreatePayload({}), {
    action: 'create-league',
    nick: '',
    name: '',
    visibility: 'private',
    durationDays: 3,
    maxParticipants: 10,
  });

  assert.equal(directory.canJoinLeague(league({ active: true })), true);
  assert.equal(directory.canJoinLeague(league({ visibility: 'private' })), false);
  assert.equal(directory.canJoinLeague(league({ finished: true })), false);
  assert.equal(directory.canJoinLeague(league({ participantCount: 10 })), false);
  assert.equal(directory.canJoinLeague(league({ participantCount: undefined, members: 9, maxParticipants: undefined })), true);
  assert.equal(directory.canJoinLeague(league({ participantCount: undefined, members: undefined })), true);

  assert.equal(directory.canPlayLeague(league({ active: true }), { attemptsLeft: 1 }), true);
  assert.equal(directory.canPlayLeague(league({ active: true }), null), false);
  assert.equal(directory.canPlayLeague(league(), { attemptsLeft: 1 }), false);
  assert.equal(directory.canPlayLeague(league({ active: true }), { attemptsLeft: 0 }), false);
  assert.equal(directory.canPlayLeague(league({ active: true }), {}), false);

  assert.equal(directory.expectedDurationMilliseconds(league({ durationDays: 1 })), 86_400_000);
  assert.equal(directory.expectedDurationMilliseconds(null), 259_200_000);
});
