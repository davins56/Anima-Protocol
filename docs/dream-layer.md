# Dream layer (feature/dream-layer)

This is backend only: no UI and no user toggle.

**What it does.** After a quiet spell, each companion "dreams" over her recent memories:
1. She clusters the embeddings of recent `memory_events`.
2. She synthesizes an abstract, non-literal dream from the heaviest cluster.
3. The dream is appended to the `dreams` table, linked to the current identity core (`identity_core_id`, `identity_version`).
4. Later, when a proactive check-in goes out after a long gap, a fragment occasionally opens it.

## Flow
1. **Scheduler.** Two triggers run the cycle:
   - The Cloudflare cron `*/15 * * * *` (`worker.ts` `DREAM_CRON`, `wrangler.jsonc`). The existing `15 * * * *` drain is unchanged.
   - `GET /api/notifications/dreams/run` with `Authorization: Bearer $CRON_SECRET`, for Node/Vercel hosts. It isn't added to `vercel.json`.
2. **Candidates** (`findDreamCandidates`). A companion qualifies when:
   - its last memory is older than `ANIMA_DREAM_INACTIVITY_MINUTES` (default 30) and newer than the lookback (72 h);
   - it has had no dream since that memory;
   - it is outside the cooldown (6 h).
3. **Cluster** (`dreamCore.clusterMemories`). Greedy cosine clustering (threshold 0.72) over up to 160 embedded, unretracted memories. Retracted memories are excluded. Document chunks and system events are excluded. The heaviest cluster (size × feeling) wins, and it needs at least 2 members and at least `ANIMA_DREAM_MIN_EVENTS` (4) memories in total.
4. **Synthesize.**
   - With the local model (background slot, job `journal`, yields to chat), the companion is prompted for abstract JSON.
   - The output is rejected if it shares any 5-word run with a source memory (`isNonLiteral`).
   - The fallback is a deterministic imagistic template built only from extracted themes. The `synthesizer` column records `llm` or `template`.
5. **Ambient opener** (`proactiveMessages.generateMessage`).
   - It applies when the agency thread follow-up doesn't, the gap is at least `ANIMA_DREAM_OPENER_GAP_HOURS` (20), and a random roll is under `ANIMA_DREAM_OPENER_CHANCE` (0.35).
   - The newest unsurfaced fragment is woven into the check-in with the same outreach guard rails.
   - Each use is appended to `dream_surfacings`, so a fragment is never reused.

## Data
Migration: `supabase/migrations/20261022270000_dream_layer.sql`.
- `dreams` and `dream_surfacings` are append-only (`anima_forbid_mutation`), select-own RLS, and writes revoked from clients.
- View `dream_recent` covers the last 30 days with `surfaced_count`.
- All three are added to `lib/db/protected-tables.ts`.
- `memory_events` is only read.

## Env (all optional; server)
| Var | Default |
|---|---|
| `ANIMA_DREAM_LAYER` | on (ops kill switch, not a user toggle) |
| `ANIMA_DREAM_INACTIVITY_MINUTES` | 30 |
| `ANIMA_DREAM_LOOKBACK_HOURS` | 72 |
| `ANIMA_DREAM_MIN_EVENTS` | 4 |
| `ANIMA_DREAM_COOLDOWN_HOURS` | 6 |
| `ANIMA_DREAM_MAX_PER_RUN` | 8 |
| `ANIMA_DREAM_CLUSTER_THRESHOLD` | 0.72 |
| `ANIMA_DREAM_OPENER_GAP_HOURS` | 20 |
| `ANIMA_DREAM_OPENER_CHANCE` | 0.35 |
| `CRON_SECRET` | existing; only for the HTTP trigger |

## Remaining
- Model dreams need the local LLM reachable from the Worker. Otherwise the template fallback is used.
- The cron granularity is 15 minutes, so the real inactivity window is 30 to 45 minutes.
- feature/continuity surfaces fragments in greetings and chat.
