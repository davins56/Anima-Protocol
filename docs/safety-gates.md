# Safety gates (server-enforced)

The client may show or hide things; the API decides.

## 1. Adult mode needs a stored age attestation

- `POST /api/safety/age-attestation { dob: "YYYY-MM-DD", confirm: true }`
  checks the date in memory (strict calendar date, completed years in UTC,
  18+) and appends a row to `age_attestations`
  (migration `20261022250000_age_attestations.sql`, append-only, RLS
  select-own, writes revoked from anon/authenticated).
- Stored: `status` (`attested` / `rejected` / `revoked`), `method`,
  `provider`, `provider_ref`, `birth_year`, `age_years`, `min_age`,
  `attested_at`. The full date of birth is **not** stored.
- A self-declared under-18 result locks self-declaration for that account
  (no retrying with another birthday). Only a provider check can lift it.
- `POST /api/safety/age-attestation/revoke` appends a `revoked` row.
- Enforcement:
  - `routes/chat.ts`: `adultGate()` (`lib/safety/adultGate.ts`) turns adult
    on only when the latest row is `attested` **and** the user asked for it
    (`settings.adult_content_enabled` or the `adult_mode` hint). The
    intimacy engine and the mode contract both follow this decision.
  - `PUT /api/store/profile`: `adult_content_enabled: true` is reset to
    `false` when the user has no attestation.
  - The lookup is cached 60 s per user, cleared on every new row, and fails
    closed (DB error means no adult mode).
- Settings → Content Rating → the 18+ dialog (`AgeGateDialog.jsx`) asks for
  the DOB plus a confirmation and only enables the toggle when the server
  says `adult_eligible`.

### Plugging in a third-party age verification provider

`lib/safety/ageGate.ts` defines `AgeVerificationProvider { id, method, verify() }`.
To add one (for example ID-document, selfie age estimation, or a
reusable-credential service):

1. Implement `verify({ userId, dob? })`, returning
   `{ status, birthYear, ageYears, providerRef }`. Usually it exchanges a
   provider session/token that the client obtained.
2. Call `registerAgeProvider(provider)` at boot, with `method: "provider"`.
3. Set `ANIMA_AGE_PROVIDER=<id>`. Rows then carry `method='provider'` and
   `provider=<id>`. A provider attestation lifts the self-declaration lock.
4. Keep the provider's keys in server env only.

Nothing else changes: chat and profile enforcement read only the latest row.

## 2. Steward checks in API middleware (audit P1-6)

- `requireSteward()` (`lib/safety/stewardGate.ts`) returns 401 when signed
  out and 403 `not_steward` for anyone else. It uses
  `callerIsProtocolSteward` (Clerk user id or email allow-list).
- `/api/repo-codespace/*` is steward-only for every route except
  `GET /status` and `/terminal`. `/terminal` keeps its ordered checks:
  worker, then opt-in, then steward. Previously any signed-in user could
  read, write and delete repo files.
- `PUT /api/store/profile` strips steward-only grant flags for
  non-stewards. The flags are `settings.echo_keys.granted_full_library`,
  `settings.energy_fragments.granted_full_library`,
  `settings.memory_crystals.granted_all_types` and
  `settings.inventory.granted_full_catalog`. The Clerk-backed lookup only
  runs when a flag is set, and is cached for 10 minutes.
- `GET /api/safety/status` returns `is_steward` so the client reflects the
  server's view.
- Already server-side before this change, left as is: `/api/tutor/*` steward
  routes and `/api/protocol-upgrade` launch.

## 3. Crossover scenes are never adult (P1-11)

`adultGate()` returns `crossover` before checking anything else. Crossover
is server-derived (group mode with 2 or more distinct universes) or
client-declared (`metadata.is_crossover`); either one is enough to turn adult
off. `resolveChatModePolicy` already maps crossover to `adultAllowed: false`.
The fix is that the intimacy engine, which keyed off the old `adultActive`,
now follows the same decision.

## Tests

`api-server/test/safetyGates.test.ts`, `test/repoCodespace.test.ts` (non-steward 403s),
`anima-protocol/src/components/settings/AgeGateDialog.test.jsx`.
