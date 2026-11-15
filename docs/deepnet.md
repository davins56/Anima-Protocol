# Deepnet (working name): vertical slice

Scope, decisions and review thread: [#757](https://github.com/davins56/Anima-Protocol/issues/757). Serenity reviews the architecture and narrative, and Dàvīn has final authority.

`deepnet` is a **neutral placeholder id**. Dàvīn asked for an original name instead of "Undernet", and the candidates are in #757. Until he picks one, ids, flags, routes and the UI label ("Deepnet (working name)") use this placeholder.

## Pure rules: `lib/deepnet-core` (`@workspace/deepnet-core`)

| File | What |
|---|---|
| `src/names.ts` | Display name, content version, banned franchise terms |
| `src/lore.ts` | `LORE_TBD(key, standIn)`: every string is a placeholder for Serenity's drafts from *Shadow Walker* and *Fallen Circuit* |
| `src/bond.ts` | Bond tiers, with the same thresholds as `useResonance.js` `RESONANCE_TIERS`. The tier is derived on the server |
| `src/decision.ts` | Resonance decision. The bond tier decides which options are available; the tuned W band against the gate band decides the outcome (`clean` / `partial` / `dissonant`) using `@workspace/sim-core` bands |
| `src/dialogue.ts` | The authored dialogue tree, plus walk and validate. No model calls |
| `src/corridor.ts` | Grey Corridor segments (entry, encounter, gate, exit) |
| `src/quest.ts` | Append-only quest events (`entered`, then `encounter_met`, `decision_made`, `resolved`). `nextQuestEvent` validates a requested step and computes the outcome; `replayQuest` re-validates a stored log |
| `src/map.ts` | `DeepnetMap`, the network-map contract that the 2D map and Anima 3D Visual's renderer read. Lock state is derived from quest state |
| `src/content/greyCorridor.ts` | Slice content. Every string in it is a `LORE_TBD` placeholder |

Tests: `artifacts/api-server/test/deepnetCore.test.ts`. They are pure and also run without Postgres via `vitest.unit.config.ts`. They also check that the package has no franchise names, no network calls and no imports other than `@workspace/sim-core`.

## Not in this package
These are not built yet:
- **Memory corruption on a dissonant outcome.** `corruptionEligible` only reports it. The design is in #757 and waits for Dàvīn's approval.
- **Cross-companion sharing.** Opt-in, summaries only, also designed in #757.
- **The surface-net proxy.**
- **Database persistence.** Migrations U1 and U2 each need Dàvīn's OK.

## API: `/api/deepnet/*` (`artifacts/api-server/src/routes/deepnet.ts`)

The server checks requests in this order:
1. `ANIMA_DEEPNET`. When it is unset or off, every route returns **404**.
2. Clerk session, or **401**.
3. `ANIMA_DEEPNET_USER_IDS`, or **403**, logged as `denied`.
4. Rate limit.
5. Ownership of `character_id`, or **403**, logged as `not_owner`.

| Route | |
|---|---|
| `GET /status` | `{enabled, allowed, display_name}` |
| `GET /map?character_id=` | `DeepnetMap`, with locks taken from server quest state |
| `POST /enter {character_id, node_id}` | Locked nodes return 403. Logs `enter` |
| `GET /quest?character_id=&quest_id=` | Quest state plus a content view. Gate option availability comes from the **server** bond tier (`anima_relationships.state.relationship_level`, read only) |
| `POST /quest/events {character_id, quest_id, expected_seq, step, dialogue_choices?, option_id?, tuned_w?}` | Validated by `nextQuestEvent`. Any tier, outcome or band sent by the client is ignored. A stale `expected_seq` returns 409 |

### Env
These are added to `CLOUDFLARE_RUNTIME_ENV_NAMES` but **not** to `wrangler.jsonc`:

| Var | Default | Meaning |
|---|---|---|
| `ANIMA_DEEPNET` | unset (off) | `on` / `1` / `true` / `yes` enables the routes |
| `ANIMA_DEEPNET_USER_IDS` | unset (nobody) | Comma-separated Clerk user ids. Dàvīn sets it to his own id. It is never committed |

### Stubs until migrations are approved
- **Quest state:** `lib/deepnet/questStore.ts` keeps state **in memory**. It is lost on restart and not shared across Worker isolates. Migration U2 replaces it.
- **Access log:** `lib/deepnet/accessLog.ts` writes structured app-log lines. Migration U1 replaces it.
- Neither adapter runs SQL.

### What the API never does
- No model calls, no tools, and no outbound fetch. A test checks the imports and fetch usage.
- No memory writes, no corruption and no sharing.
