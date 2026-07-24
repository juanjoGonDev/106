# Profile cards, league previews and league trophies

## Player profile revisions

Public player profiles expose a monotonic `profileRevision` derived from every persisted event that changes the profile card:

- global attempts;
- referral and bonus updates;
- closed daily trophies;
- achievements;
- eligible league champion trophies.

The revision is appended to the crawler-facing share URL and to the PNG URL. Unchanged profiles keep cacheable URLs; changed profiles receive a new cache key immediately.

The GitHub Pages player document mirrors the current Open Graph and X/Twitter tags for browser inspection. Social crawlers must use the server-rendered `social-share` route because static Pages HTML cannot emit nickname-specific metadata before JavaScript runs.

## Share routes

Player profile:

```text
/functions/v1/social-share/player/<nick>
/functions/v1/social-share/player/<nick>/achievements
/functions/v1/social-share/player/<nick>/trophies
```

The metadata image remains rendered by `player-share`:

```text
/functions/v1/player-share/<nick>/card.png?v=<profileRevision>
/functions/v1/player-share/<nick>/achievements.png?v=<profileRevision>
/functions/v1/player-share/<nick>/trophies.png?v=<profileRevision>
```

League metadata and image:

```text
/functions/v1/social-share/league/<public-id>?v=<leagueRevision>
/functions/v1/social-share/league/<public-id>/card.png?v=<leagueRevision>
```

Human visitors use the clean website route:

```text
https://juanjogondev.github.io/106/ligas/<public-id>
```

The public identifier is not a join credential. Membership requires the separate private `join_code`, which only the authenticated owner receives as `joinCode`. The social renderer and public page use the immutable `public_id` and emit a 1200×630 PNG with the current activation state, eligible identity counts, leaderboard or champion.

## Eligible league activation

New leagues start in a waiting state. Their three-day competition clock starts exactly once after the membership contains a valid set of three participants satisfying both conditions:

1. three pairwise-distinct anonymous account IDs;
2. three pairwise-distinct stable device identities.

Device identity uses the player's first recorded device hash. Reopening a league from another browser or device does not rotate that identity. Multiple nicks linked to one account do not increase the eligible-owner count.

Existing leagues are grandfathered as active during migration to avoid invalidating competitions already in progress.

The backend rejects challenge creation while a league is waiting. The frontend only exposes the competition action after the API reports the league as active.

## League champion trophies and podium achievements

An eligible completed league can persist one `league_champion` trophy. Selection is deterministic:

1. smallest verified difference;
2. earliest attempt;
3. nickname key;
4. attempt ID.

The league must still satisfy the three-account and three-device eligibility rule. A completed league without a verified attempt produces no trophy. Synchronization is idempotent and protected by advisory locks.

The first three eligible finishers also receive persistent podium achievements with points. Their metadata stores the public league identifier, league name, final position and best difference. League trophies and achievements appear in the public player history with the league name, public route and award date, and update the player profile revision. Deployment snapshots treat their row counts as monotonic history.

## Supabase function privilege warning

`reward_referred_player()` is a trigger function and must never be callable through the Data API. Migration `20260724113000_secure_referral_trigger.sql` revokes execution from:

- `PUBLIC`;
- `anon`;
- `authenticated`.

No Dashboard configuration is required. Applying the migration is sufficient. The local integration suite queries `pg_proc` and `has_function_privilege` to verify that the function remains `SECURITY DEFINER` for trigger execution while both exposed API roles lack `EXECUTE`.

## Deployment

The normal Supabase workflow applies the additive migrations and deploys the registered `social-share` and `player-context` Edge Functions. Do not manually edit applied migrations or execute schema changes in the Dashboard.

After deployment, confirm:

```text
/functions/v1/social-share/player/<known-nick>
/functions/v1/social-share/league/<known-public-id>
https://juanjogondev.github.io/106/ligas/<known-public-id>
```

Both metadata responses should contain versioned `og:image` and `twitter:image` URLs. The corresponding PNG routes must return `image/png` at 1200×630. Public league responses and profile links must not contain the private `joinCode`.
