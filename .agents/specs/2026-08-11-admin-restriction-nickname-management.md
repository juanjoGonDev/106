# Admin restriction and nickname management

Status: Approved by user request / implementation pending
Date: 2026-08-11
Branch: `agent/feat-admin-restriction-nickname-management`
Base: `main` at `68d73e79668953635bc44c9810668c755239bf54`

## Objective

Extend the existing `/zadmin/` security console so an operator can manage effective automatic integrity restrictions and moderate player nicknames without deleting security evidence or relying on nickname text as the new administrative identity boundary.

## User outcomes

1. See one global, filterable list of current and historical restrictions across manual and policy-v3 automatic sources.
2. Expand any automatic restriction to inspect scope, account/device/IP target, source attempt, policy version, expiry and private evidence.
3. Lift an automatic restriction with a mandatory reason and later reinstate it if needed, while retaining the immutable original policy-v3 ban.
4. Search players by account/nickname and manage them through a stable `player_id`.
5. Rename a nickname immediately from zadmin when an operator knows the replacement.
6. Force a nickname reset when the current name is unacceptable: remove the public offending alias immediately, assign a safe temporary alias, and require the owner to choose a new valid nickname before competitive actions continue.
7. Preserve ownership, attempts, rewards, leagues, duels, referrals, achievements, bans and profile continuity across nickname changes.
8. Show the player an application-owned, keyboard-accessible required-rename component on the next account/game access until the rename is completed.

## Existing architecture detected

- `public.game_accounts.id` is already the stable account identity.
- `public.game_players.nick_key` is currently the primary key and many historical/domain relations still use nickname keys.
- `game_attempts` and `game_challenges` also persist nickname snapshots/keys and predate `game_players`.
- Account ownership is represented by `game_account_players(account_id, nick_key)`.
- Policy-v3 automatic restrictions live in append-only `game_integrity_bans`; current zadmin surfaces them read-only.
- Effective gameplay restriction checks resolve manual restrictions first and policy-v3 restrictions through the canonical integrity-ban functions.
- Zadmin sessions are opaque server-validated tokens persisted only in `sessionStorage` after PR #73.
- The repository has branded Supabase **Auth** email templates and an external SMTP provider configured for Auth, but no verified general transactional-email sender exposed to application Edge Functions. This task must not misuse recovery/magic-link flows to send moderation email.

## Data model decisions

### Stable player identity

Add `game_players.player_id uuid` as a generated, unique, non-null stable identifier. Existing `nick_key` remains the compatibility primary key during this migration so legacy domain functions and public nickname URLs continue to work.

New administrative/moderation state must reference `player_id`, never nickname text as its identity.

Backfill `player_id` into `game_account_players` and expose it in account/admin projections. Existing nickname-key consumers remain compatible while future migrations can move remaining domain FKs to `player_id` incrementally.

### Safe nickname rename compatibility

All foreign keys that reference `game_players(nick_key)` must be made `DEFERRABLE` so one transaction can update the player key and dependent compatibility projections atomically.

The canonical rename function must:

- lock the stable player identity and both old/new nickname namespaces;
- validate availability and normalized key at the database boundary;
- defer relevant FK checks;
- change `game_players.nick/nick_key`;
- update every direct FK that references `game_players(nick_key)` through catalog-driven constrained updates;
- explicitly update legacy non-FK nickname snapshots used by `game_attempts` and `game_challenges`;
- move active/manual nickname bans to the new compatibility key so enforcement remains attached to the same player;
- preserve immutable audit metadata rather than rewriting historical action descriptions;
- preserve `player_id` unchanged;
- fail atomically on any conflict.

### Forced rename state

Create a private `game_player_name_requirements` table keyed by `player_id` with current required-change state, reason, requested/resolved timestamps and actor session.

Create append-only `game_admin_nickname_actions` history for `rename`, `require_change` and `resolve_change` events. Updates/deletes to this history must be rejected at the database boundary.

A forced reset immediately replaces the unacceptable public nickname with a collision-safe neutral temporary nickname derived from the stable player ID, then marks rename as required. The player keeps the same `player_id`, ownership and competitive history.

### Automatic restriction administration

Do not mutate or delete `game_integrity_bans`.

Create append-only `game_integrity_ban_admin_actions` with actions `lift` and `reinstate`, mandatory reason, actor session and timestamp.

The canonical active-integrity-ban lookup must ignore a ban when its latest admin action is `lift`; a later `reinstate` makes the still-unexpired original ban effective again. Expired original bans never become active again merely because of an admin action.

## Backend / API

Use a dedicated `zadmin-management` Edge Function so the existing investigation API remains cohesive. The new function reuses `zadmin_validate_session` and the same IP/device-bound bearer session contract.

Required actions:

- `restrictions`: paginated/filterable automatic/manual restriction management projection.
- `lift-integrity-restriction`.
- `reinstate-integrity-restriction`.
- `players`: search/list player/account moderation state.
- `rename-player`.
- `require-player-rename`.

Player-facing nickname completion should use the existing account-token boundary, not require a Supabase social/email login. Extend `player-context` with:

- account context returning an applicable `nicknameRequirement` projection.
- `complete-required-rename`, requiring the private account token, ownership of the stable player ID and normal nickname validation/moderation.

Competitive start/link flows must reject `nickname_change_required` while an owned player has an unresolved requirement.

## Email boundary

No general transactional mail sender is verifiably available to Edge Functions. Therefore this PR guarantees the in-app notice and stores whether a verified account contact email exists, but does **not** claim an email was sent.

The admin UI may display `Email verificado disponible` as delivery capability metadata. A future mail-sender task can consume the append-only nickname action/outbox data without changing the moderation semantics.

Do not send a password-reset, magic-link or invitation email as a moderation notification.

## Zadmin UX

Add a `Gestión` section/page linked from the existing authenticated zadmin navigation. It remains unavailable from the normal public site layout.

### Restrictions view

Mobile-first one-column cards; desktop may use a denser table/list with local expansion.

Each row/card shows:

- source (`Manual` / `Integridad automática`),
- active/lifted/expired status,
- scope,
- account/nickname correlation when available,
- created/triggered timestamp,
- expiry or permanent state.

`Expandir` uses progressive disclosure and shows policy/evidence for automatic restrictions. Active automatic restrictions expose `Quitar restricción`; lifted restrictions expose `Restaurar restricción` while the original expiry is still in the future.

The lift/reinstate form is inline, requires a 3–500 character reason, supports Escape/cancel and restores focus. No `alert`, `confirm`, `prompt`, native browser modal, `<dialog>` or `showModal()`.

### Players view

Search by current nickname, stable player ID or account ID. Show:

- current nickname,
- short player ID,
- account ID,
- verified contact email availability (never expose unnecessary identity data in list rows),
- rename-required status.

Actions:

- `Renombrar ahora`: inline replacement nickname + reason.
- `Forzar cambio`: mandatory reason; immediately assigns a safe temporary alias and marks rename required.

Do not expose destructive actions as icon-only controls.

## Player UX

When account context reports an unresolved nickname requirement, show one application-owned blocking rename component before competitive actions. Reuse the existing nickname validation/moderation/availability components and tokens.

The component must:

- explain that the current nickname was reset by moderation and a new nickname is required;
- use a persistent label, not placeholder-only input;
- preserve input after recoverable errors;
- validate after the user has had a chance to enter the name;
- support keyboard and visible focus;
- work at 320 CSS px without horizontal overflow;
- not expose internal moderation/admin evidence;
- update local selected nickname after success and dismiss only after the server confirms the rename.

A forced rename is a real prerequisite, so the component may interrupt gameplay; it must be application-owned and accessible, not a browser-native dialog.

## Accessibility / responsive

- WCAG 2.2 AA target.
- Semantic buttons/links/forms before ARIA.
- 44x44 CSS px touch targets where reasonable.
- Visible focus and logical DOM order.
- No global horizontal scrolling at 320px.
- `prefers-reduced-motion` respected.
- Expansion state keyboard-operable.
- Status changes use existing live-region patterns.

## Security invariants

- No admin credential or raw bearer token in logs/database/plain frontend storage beyond same-tab `sessionStorage` already established.
- Every management mutation requires a current IP/device-bound zadmin session.
- Every player rename completion requires the private account token and ownership of the `player_id`.
- Nickname validation/moderation is enforced server-side using the existing shared policy.
- Original policy-v3 evidence remains immutable.
- Restriction overrides and nickname actions are append-only/audited.
- Browser roles cannot read management tables or invoke privileged RPCs.
- Stable player IDs may be returned to authenticated zadmin/account-owner flows but should not be added to public profile payloads unless required.

## Planned files

Create:

- `supabase/migrations/20260811133000_admin_restriction_nickname_management.sql`
- `supabase/functions/zadmin-management/index.ts`
- `public/zadmin/management.html`
- `public/zadmin/management.js`
- `public/zadmin/management.css`
- focused unit/security and E2E tests for the new management surface and rename requirement.

Modify as required after inspection:

- `public/zadmin/index.html` to link the management surface.
- `supabase/functions/player-context/index.ts` for owner-facing required rename state/completion.
- `supabase/functions/game-api/index.ts` only where needed to enforce unresolved rename state before competitive/link actions.
- public account/competition bootstrap/component files needed to surface the forced rename component.
- platform evidence inventory for the new zadmin/player states.
- deployment/cache revision contracts if the migration changes player projections.

## Validation

### Database / backend

Real local PostgreSQL/Supabase tests must prove:

- `player_id` backfill is unique/stable/non-null.
- rename preserves player_id/account ownership and all historical domain relationships.
- nickname conflict rolls back without partial mutation.
- forced reset removes the unacceptable public alias immediately and sets requirement.
- owner can complete required rename through account-token boundary.
- another account cannot complete it.
- automatic ban lift immediately changes canonical effective restriction lookup.
- reinstate works only while the original ban is still unexpired.
- original integrity-ban row/evidence never changes.
- override/action ledgers reject update/delete.
- anon/authenticated roles cannot access private moderation data/RPCs.

### Frontend / E2E

Desktop and Mobile Playwright must cover:

- management restriction list, expansion, lift and reinstate;
- player search;
- immediate admin rename;
- forced reset;
- required-rename player component, invalid/occupied nick, successful rename and local selected-name refresh;
- keyboard/Escape/focus recovery;
- 320px reflow and no global overflow;
- no native browser dialogs or unexpected console/request errors.

### CI / evidence

- Frozen install/build/syntax.
- ESLint/Knip.
- Unit/security coverage; new isolated state logic at 100% line/function/branch where technically reasonable.
- All maintained Supabase suites including clean migrations and upgrade-shaped migration checks.
- Complete Desktop/Mobile platform evidence from the final PR head, including PNG + WebM/GIF for management and required-rename interactions.
- Pull Request body follows `.github/pull_request_template.md` and final Visual Evidence metadata gate is green.

## Out of scope

- Replacing every legacy public/domain function with `player_id` in this single migration.
- Adding a new SMTP/provider secret or external transactional-email service.
- Deleting original automatic bans, attempts, account history or moderation audit records.
- Merge or production deployment without explicit authorization.
