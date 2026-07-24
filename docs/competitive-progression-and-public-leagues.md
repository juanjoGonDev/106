# Competitive progression and public leagues

## Global precision order

The global leaderboard keeps one best verified global attempt per nickname. Smaller distance from 10.600 always wins. Exact time ties use the following criteria, in order:

1. achievement points;
2. closed daily trophies;
3. league championships;
4. verified global attempt count;
5. lower average verified global difference;
6. earlier timestamp for the best result;
7. normalized nickname.

League championships intentionally have lower precedence than daily trophies and achievement points. The final timestamp and nickname criteria only make the result deterministic.

The home Top 10 remains compact. `ranking.html` explains the full ordering and only renders tie-break evidence for players whose best difference is exactly equal.

## Achievement progression

Achievements are append-only and idempotent through `(nick_key, achievement_code)` uniqueness. New families cover:

- exact 10.600 attempts at 1, 3, 5, 10, 25, 50 and 100;
- an exact zero-millisecond average after at least three verified attempts;
- verified attempt totals from 5 through 500;
- first marks inside 1 second, 250 ms, 100 ms, 50 ms and 10 ms;
- completed referrals;
- direct challenges created;
- direct challenge victories at 1, 5, 10, 50 and 100;
- participation in eligible completed leagues;
- a persistent achievement for first, second or third place in each eligible completed league.

The champion still receives the existing league trophy. Podium achievements store the public league identifier, league name, final position and best difference. Public player profiles can therefore link the result to the league and display its award date.

Progression refreshes after verified attempts, direct challenge changes and league trophy synchronization. Backfill runs once during migration and remains safe to repeat.

## League identifiers and credentials

A league now has three separate concepts:

- `public_id`: immutable six-character identifier used by public pages, social metadata and profile links;
- `code`: internal competition scope used by existing game RPCs; it is equal to `public_id` and is not a credential;
- `join_code`: private six-character invitation credential used only to add a member.

Migration order intentionally protects existing data:

1. the previously public `code` is copied to `public_id` so old public links remain valid;
2. a fresh credential is generated for each existing league;
3. that fresh credential is moved into `join_code`;
4. `code` is normalized to the safe public identifier.

As a result, credentials previously exposed in URLs no longer grant entry. Owners receive the current `joinCode` only through their authenticated player context. Other members receive the public competition identifier but never the invitation credential.

Anonymous league responses, social cards, profile trophies and clean URLs must never contain `join_code`.

## Public routes and sharing

Human-facing league URLs use:

```text
https://juanjogondev.github.io/106/ligas/<public-id>
```

GitHub Pages `404.html` resolves that clean route to `ligas.html` while preserving the public identifier. The page is readable without a nickname, account token or invitation code.

Owners can share a private invitation containing `joinCode`. Normal league sharing contains only the clean public URL. Dynamic social metadata and the 1200×630 PNG use the public identifier and a versioned league revision.

Every dedicated document touched by this feature includes static Open Graph and X/Twitter fallback metadata. Runtime league metadata replaces it with league-specific title, description, canonical URL and versioned image.

## Player context and nickname availability

The home uses one `player-context` request after 350 ms of inactivity in the nickname input. Every new keystroke cancels the timer and invalidates in-flight responses, so stale requests cannot replace the latest state.

The endpoint returns:

- `availability`: `available`, `occupied` or `owned`;
- the public profile when one exists;
- joined leagues only when the supplied account token owns the nickname.

Typing an unused nickname does not create an account. Importing or changing the account key triggers an immediate context refresh.

`app.js`, the honours view and sharing reuse this context instead of issuing independent profile requests.

## Competition selector and attempt limits

The home selector contains:

- the global ranking;
- every joined league returned by player context.

Global is the default. A previously selected active league is restored from local storage. Waiting, finished and exhausted leagues remain visible but disabled. The global option remains selected when its attempts are exhausted until the player explicitly chooses another competition.

The start and retry paths both validate the selected scope. They cannot create a challenge when:

- nickname ownership is invalid;
- context resolution is pending;
- the selected league is waiting or finished;
- the selected competition has no attempts left;
- a league lacks a valid public competition identifier.

Global and each league keep separate attempt budgets.

## Operational validation

Required validation includes:

- clean database rebuild and incremental migration;
- local Edge Function integration covering public lookup, private joining and attempt scoping;
- deterministic ranking and achievement contract tests;
- browser tests for debounce, stale responses, occupied nicknames, exhausted attempts, selector persistence and clean league routes;
- desktop and mobile screenshots for the home, dedicated ranking and public league page;
- package, lint, type, security, dead-code and deployment snapshot checks.

Applied migrations are never rewritten or rolled back destructively. Any production correction must be a new forward migration.
