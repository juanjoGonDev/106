import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'attempts.json');
const TARGET_MS = 10_600;
const MAX_ATTEMPTS_PER_NICK = 5;
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let writeQueue = Promise.resolve();

function normalizeNick(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function normalizeTeam(value) {
  return value === 'argentina' ? 'argentina' : value === 'spain' ? 'spain' : null;
}

async function readStore() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { attempts: [] };
  }
}

function saveStore(store) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
  });
  return writeQueue;
}

function publicAttempt(attempt) {
  return {
    id: attempt.id,
    nick: attempt.nick,
    team: attempt.team,
    elapsedMs: attempt.elapsedMs,
    differenceMs: attempt.differenceMs,
    createdAt: attempt.createdAt,
  };
}

function buildStats(attempts) {
  const bestByNick = new Map();
  for (const attempt of attempts) {
    const key = `${attempt.team}:${attempt.nickKey}`;
    const current = bestByNick.get(key);
    if (!current || attempt.differenceMs < current.differenceMs) bestByNick.set(key, attempt);
  }

  const ranked = [...bestByNick.values()].sort(
    (a, b) => a.differenceMs - b.differenceMs || a.createdAt.localeCompare(b.createdAt),
  );

  const teams = ['spain', 'argentina'].map((team) => {
    const teamAttempts = attempts.filter((attempt) => attempt.team === team);
    const teamBest = ranked.filter((attempt) => attempt.team === team);
    const averageDifferenceMs = teamBest.length
      ? Math.round(teamBest.reduce((sum, attempt) => sum + attempt.differenceMs, 0) / teamBest.length)
      : null;

    return {
      team,
      attempts: teamAttempts.length,
      players: teamBest.length,
      averageDifferenceMs,
      score: teamBest.reduce((sum, attempt) => sum + Math.max(1, 1000 - attempt.differenceMs), 0),
    };
  });

  return {
    targetMs: TARGET_MS,
    maxAttemptsPerNick: MAX_ATTEMPTS_PER_NICK,
    totalAttempts: attempts.length,
    teams,
    leaderboard: ranked.slice(0, 20).map(publicAttempt),
  };
}

app.get('/api/stats', async (_req, res, next) => {
  try {
    const store = await readStore();
    res.json(buildStats(store.attempts));
  } catch (error) {
    next(error);
  }
});

app.get('/api/nicks/:nick', async (req, res, next) => {
  try {
    const nick = normalizeNick(req.params.nick);
    if (!nick) return res.status(400).json({ error: 'Nick inválido.' });
    const nickKey = nick.toLocaleLowerCase('es');
    const store = await readStore();
    const attempts = store.attempts.filter((attempt) => attempt.nickKey === nickKey);
    res.json({ nick, attemptsUsed: attempts.length, attemptsLeft: Math.max(0, MAX_ATTEMPTS_PER_NICK - attempts.length) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/attempts', async (req, res, next) => {
  try {
    const nick = normalizeNick(req.body.nick);
    const team = normalizeTeam(req.body.team);
    const elapsedMs = Math.round(Number(req.body.elapsedMs));

    if (!nick || nick.length < 2) return res.status(400).json({ error: 'El nick debe tener al menos 2 caracteres.' });
    if (!team) return res.status(400).json({ error: 'Selecciona España o Argentina.' });
    if (!Number.isFinite(elapsedMs) || elapsedMs < 500 || elapsedMs > 30_000) {
      return res.status(400).json({ error: 'Intento fuera del rango permitido.' });
    }

    const nickKey = nick.toLocaleLowerCase('es');
    const store = await readStore();
    const attemptsUsed = store.attempts.filter((attempt) => attempt.nickKey === nickKey).length;
    if (attemptsUsed >= MAX_ATTEMPTS_PER_NICK) {
      return res.status(409).json({
        error: 'Este nick ya ha agotado sus 5 intentos. Puedes competir de nuevo con otro nick.',
        attemptsLeft: 0,
      });
    }

    const attempt = {
      id: crypto.randomUUID(),
      nick,
      nickKey,
      team,
      elapsedMs,
      differenceMs: Math.abs(TARGET_MS - elapsedMs),
      createdAt: new Date().toISOString(),
    };

    store.attempts.push(attempt);
    await saveStore(store);

    const stats = buildStats(store.attempts);
    const position = stats.leaderboard.findIndex((entry) => entry.id === attempt.id) + 1;
    res.status(201).json({
      attempt: publicAttempt(attempt),
      attemptsLeft: MAX_ATTEMPTS_PER_NICK - attemptsUsed - 1,
      position: position || null,
      stats,
    });
  } catch (error) {
    next(error);
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Error interno. Inténtalo de nuevo.' });
});

app.listen(PORT, () => {
  console.log(`Minuto 106 disponible en http://localhost:${PORT}`);
});
