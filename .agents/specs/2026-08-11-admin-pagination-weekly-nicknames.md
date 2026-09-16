# Admin pagination, persistent session and nickname lifecycle

Status: Complete
Date: 2026-08-11
Branch: `agent/feat-admin-pagination-weekly-nicknames`
Base: `main` at `65caf9b48c0b258ed5889b70527a0519ec409d36`

## Objective

Finish the zadmin management surface so automatic restrictions can be lifted reliably, admin sessions survive closing/reopening the tab while remaining server-bound, all admin lists are paginated server-side, and nickname changes use one canonical validation/moderation pipeline across admin, forced rename, home and account self-service.

## Required outcomes

1. Automatic policy-v3 restrictions can be lifted and reinstated from zadmin with a mandatory reason. The original `game_integrity_bans` row/evidence remains immutable; gameplay enforcement must immediately observe the latest admin override.
2. The restriction list exposes the action directly in the expanded item and reports DB/API errors with stable codes. Real PostgreSQL integration must prove action + audit + canonical enforcement in one transaction.
3. Admin sessions survive page reload and browser-tab close/reopen by persisting only the opaque session token in `localStorage`. Every request still revalidates token hash + IP hash + device hash + revoked state + sliding idle expiry. Logout/invalid session clears all persisted copies. Credentials are never stored.
4. Zadmin lists use server-side pagination with bounded `pageSize`, deterministic ordering and total counts. This applies to the main investigation lists and the management restrictions/players lists. Filters/search reset to page 1. Destructive actions refresh the current page and clamp to the last valid page when totals shrink.
5. Admin can rename any player manually by stable `player_id`; moderation rename is not subject to user cooldown.
6. A signed-in account owner can voluntarily rename each owned player at most once every 7 days per `player_id`. Renaming one of five players must not block the other four. The API returns `nextRenameAt`/`retryAfterSeconds`; the UI shows an absolute timestamp plus live countdown and keeps the action disabled until the server window expires.
7. Forced moderation rename does not consume the voluntary weekly cooldown. Completing a forced rename does not consume it either unless explicitly documented otherwise; the cooldown tracks voluntary owner rename events only.
8. The required-rename component shows the offending/original nickname as well as the current temporary nickname, without exposing private moderation evidence.
9. Every nickname input uses the same local structural policy and the same server moderation/availability boundary. No admin-only `length` checks or duplicate regexes. New reusable browser controller/component logic must be used by admin management, required rename and account self-service while preserving the existing home gate.
10. New isolated frontend decision/state modules must have 100% line/function/branch coverage. Existing strict repository coverage thresholds must not be weakened.

## Data model

Use the stable `game_players.player_id` introduced by the current admin-management migrations.

Add append-only `game_player_nickname_changes` keyed by `player_id` with at least:

- `player_id`
- `source` in `owner_voluntary | admin | forced_completion`
- `old_nick`, `old_nick_key`
- `new_nick`, `new_nick_key`
- optional admin session id
- `created_at`

The voluntary cooldown owner queries only `source = 'owner_voluntary'` and computes `last_changed_at + interval '7 days'` for the specific `player_id`.

Do not infer cooldown from mutable nickname text and do not apply it account-wide.

The forced-name requirement must retain the pre-reset nickname in private moderation state (`original_nick` / `original_nick_key`) so the owner-facing projection can say which name was reset while still hiding the admin reason/evidence details.

## Nickname owner

The Edge boundary must use the shared `supabase/functions/_shared/nickname-policy.js` structural validator plus the existing moderation owner from `game-api/moderation.ts`.

The browser boundary must expose one reusable nickname field controller built on `Minuto106NicknamePolicy` for:

- structural validation and normalization,
- shared error messages,
- remote availability state,
- pending/available/owned/taken/invalid state,
- accessible `aria-invalid` and status messaging.

The server remains authoritative for moderation and uniqueness.

## Admin session persistence

Replace zadmin-specific direct `sessionStorage` access with one shared zadmin session-store module.

Persistence rules:

- primary persistence: `localStorage`, so closing/reopening a tab preserves the opaque token;
- one-time migration: read a valid legacy `sessionStorage` token and promote it;
- server validation always happens before privileged UI becomes usable;
- invalid/expired/revoked session clears local + session storage;
- logout clears local + session storage;
- do not store username/password, session ID, IP hash or device hash.

## Pagination

All list APIs accept validated `page` and `pageSize` (default 25, allowed 10/25/50, hard max 50) and return:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 0,
    "totalPages": 0,
    "hasPrevious": false,
    "hasNext": false
  }
}
```

Existing response keys may remain as compatibility aliases during this PR if needed, but UI must consume the canonical pagination object.

Database/PostgREST queries must apply deterministic ordering before ranges. Avoid fetching 500/2000 rows and slicing in Edge memory for the primary lists.

## Automatic restriction administration

Keep `game_integrity_bans` immutable. Latest `game_integrity_ban_admin_actions` action remains the override owner.

Tests must prove:

- active -> lift -> canonical enforcement returns not banned;
- lift audit event is inserted;
- original evidence/reason/expiry unchanged;
- lifted -> reinstate -> canonical enforcement returns banned while original expiry is active;
- expired ban cannot be reinstated;
- duplicate lift/reinstate returns deterministic conflict code;
- invalid/expired admin session fails closed.

## Owner self-service rename

Extend `player-name-management` with:

- `list`: return account-owned players with stable IDs, current nick, rename cooldown projection and required-rename state;
- `check`: validate/moderate/availability for a candidate nick using the same owner as admin/forced flows;
- `rename`: voluntary rename for one owned `player_id`, enforcing the 7-day per-player cooldown transactionally;
- existing forced `status` / `complete` remain supported and use the same validation owner.

Concurrency: two simultaneous owner renames for the same player must serialize and only one may succeed. Different players on the same account may rename independently.

## Account UX

Add a nickname-management section to `Mi cuenta` listing all owned players with:

- current nickname,
- `Cambiar nick` action,
- next eligible timestamp/countdown when cooling down,
- inline persistent rename form using the shared nickname input controller,
- accessible status/recovery; no browser-native dialogs.

## Required rename UX

The blocking component must show:

- `Nombre anterior: <original nick>`
- `Nombre temporal actual: <temporary nick>`
- explanation that a new valid nickname is required.

It must reuse the same nickname field controller and retain typed value after recoverable errors.

## Zadmin UX

- Management restrictions and players lists have pagination controls with page status and page-size selector.
- Main investigation list(s) gain the same pagination primitive; no unbounded list rendering.
- Automatic restrictions expose lift/reinstate with reason and stable success/error state.
- Player cards expose manual rename and forced rename using the shared nickname field controller.
- No `alert`, `confirm`, `prompt`, native `<dialog>` or `showModal()` for new flows.

## Security

- Browser roles cannot invoke admin RPCs or read moderation/cooldown ledgers directly.
- Account-token endpoint only renames players owned by that canonical account.
- Admin endpoint requires current IP/device-bound zadmin session.
- Nickname validation/moderation/uniqueness enforced server-side even if JS is bypassed.
- All admin and owner rename mutations are transactional and audit/history preserving.
- Opaque admin token in persistent browser storage is accepted only because the user explicitly requires reopen persistence; its impact remains bounded by server-side IP/device binding, revocation and sliding expiry.

## Validation

### Database / integration

- Clean migration reset.
- Production-shaped migration compatibility.
- Automatic restriction lift/reinstate full transaction.
- Admin rename full transaction and legacy-reference preservation.
- Owner voluntary rename success.
- Same player second rename inside 7 days rejected with exact countdown projection.
- Different player on same account can rename immediately.
- Rename after exactly 7 days succeeds.
- Concurrent same-player rename race serializes.
- Unauthorized account cannot rename another player's ID.
- Forced rename status exposes original nick but not private admin evidence.
- Append-only rename history rejects update/delete.
- anon/authenticated cannot access private tables/RPCs.

### Frontend / E2E

Desktop + mobile + 320px must cover:

- persistent zadmin session after reload and a new page/context using persisted local token;
- logout and invalid-session clearing;
- paginated restrictions and players, next/previous/page-size/filter reset;
- automatic lift/reinstate UI;
- admin manual rename with canonical validation states;
- account player list and one-week cooldown countdown;
- second owned player remains independently renameable;
- required rename displays original + temporary nickname;
- shared nickname controller invalid/taken/available/pending/recovery states;
- keyboard, focus, reduced motion and no horizontal overflow;
- zero unexpected page/console/request errors, except an explicitly asserted browser network-console entry for the intentional 429 cooldown response used to prove server-authoritative stale-UI recovery.

### Coverage / CI

- 100% line/function/branch coverage for every new isolated frontend/controller/state module.
- Existing global quality thresholds unchanged.
- ESLint, Knip, build and security policy gates green.
- All maintained Supabase suites green.
- Complete Desktop/Mobile platform evidence from the final PR head with PNG and interaction WebM/GIF for changed frontend flows.
- PR body follows `.github/pull_request_template.md` and final visual-evidence metadata gate is green.

## Completion evidence

The implementation head immediately before this documentation-only completion commit was `51e59a8e405888685267f1524e59ce5d01eebcbd`.

On that head:

- Pull Request Quality Pipeline `31545737903` passed, including build, Vitest, ESLint, Knip, dependency/policy checks and all maintained Supabase suites.
- Authentication Quality `31545737955`, Public Asset Audit `31545737959` and CodeQL Advanced `31545738059` passed.
- Player Pages and Social Cards `31545737985` passed after re-running only Desktop shard 3/8 for a runner DNS failure (`ERR_NAME_NOT_RESOLVED`); all 16 Desktop/Mobile shards then passed on the unchanged head.
- The strict frontend coverage job passed, including 100% line/function/branch coverage for `nickname-field-controller` and `zadmin/session-persistence`.
- Platform evidence `platform-evidence-31545737985` was generated from that head and its changed-area Desktop/Mobile captures were reviewed for required nickname change and zadmin management.

This specification commit is documentation-only. GitHub Actions on the resulting final head remains the authority before the PR can be reported complete, and the PR body must link the final-head platform artifact rather than the implementation-head artifact above.

## Delivery

One task branch, one non-draft PR to `main`. No merge, production migration or production deployment without explicit user authorization.