# Immersive sim: 4D net battle

This is Battle Network combat with a fourth axis, **W**. W is the resonance frequency, 0–100. It uses the same five bands as the Figma tokens and the FrequencyTuner.

| Band | W range | Clarity at band centre |
|---|---|---|
| noise | 0–20 | 0.15 |
| ambient | 20–45 | 0.45 |
| data | 45–75 | 0.65 |
| rare | 75–88 | 0.85 |
| serenity | 88–100 | 1.00 |

## Where things live

| Piece | Path |
|---|---|
| Deterministic engine (pure TS, shared by client and server) | `lib/sim-core/src/{bands,types,chips,rules,consequences,engine,validate,glitch}.ts` (`@workspace/sim-core`) |
| App entry points | `artifacts/anima-protocol/src/lib/sim/{engine,rules,consequences}.ts` (re-exports), `useSimBattle.ts`, `simApi.ts`, `vesselModel.ts` |
| 3D arena | `src/components/sim/SimArena3D.tsx`, `PhaseShiftFx.tsx`, `BandGlyph.tsx` |
| HUD | `src/components/sim/SimHud.tsx` (W gauge, clarity/comms, FrequencyTuner), `ChipSelect.tsx` (Custom screen) |
| Route | `/resonance/arena?node=&w=&character=&name=` → `src/pages/SimArena.tsx` (lazy, via `app/extraPages.jsx`). It's launched with **Jack in** on hostile or noise nodes in `/resonance`. |
| Server | `artifacts/api-server/src/routes/sim.ts`, `src/lib/sim/simStore.ts` |
| SQL | `supabase/migrations/20261022200000_immersive_sim.sql` |

## Arena

Each W layer is one Battle Network end-fight room: 6×3 panels. The navi owns columns 0–2 and the viruses own columns 3–5. There are five layers, one per band, stacked along W.

Positions are discrete, but the display crossfades between layers. While a unit is phasing, its W is interpolated, and the camera, panel tint and ghosting all follow that continuous W.

## Event bus and consequences

Every input becomes an event. The bus processes events breadth-first:

1. It applies the event with the reducer in `consequences.ts`.
2. It runs every rule that listens for that event type (`rules.ts`).
3. It queues the rules' follow-up events. The cascade stops at depth 8 or 512 events.

Each emitted event carries `seq`, `depth` and `cause`, so you can trace any consequence back to the input that started it.

| Rule | Trigger, then effect |
|---|---|
| `chip.effects` | A chip resolves into hits, panel changes (crack, poison, holy), portals (PhaseGate) or a purify. Damage is scaled by `0.5 + 0.5·clarity(W)` × band affinity (same band ×1.5, adjacent ×1, two or more bands apart ×0.7). |
| `hit.damage` | A hit becomes damage. A holy panel halves it. |
| `hit.mismatch.corrupts` | A virus hits Serenity while she is two or more bands from its frequency. This drains 4 memory and may **corrupt a memory**. |
| `hit.dissonance` | The navi hits a virus two or more bands away from her own band. This drains 2 memory. |
| `hit.noise.cracks` | A noise-band hit has a 25% chance (seeded RNG) to crack the panel it lands on. |
| `panel.cracked.breaks` | Stepping off a cracked panel breaks it for 4 s. Broken panels can't be entered, and a unit landing on one is shoved to a free panel. |
| `memory.empty.corrupts` | Memory reaching 0 forces a corruption. |
| `damage.defeat` / `defeat.outcome` | A unit at 0 HP is defeated. A defeated virus gives +10 memory. The last virus defeated means a win; the navi defeated means a loss. |
| `restore.refund` | Purify gives +5 memory. |
| `phase.portal.single_use` | Travelling through a PhaseGate closes it. |

Per-tick systems:

- **Custom gauge:** fills in 10 s.
- **Terrain timers:** broken, poison and holy panels revert when their time runs out.
- **Poison:** 4 damage every 0.5 s.
- **Portals:** close when their time runs out.
- **Phase landings.**
- **Telegraphed attacks:** a virus attack resolves 0.8 s after its warning.
- **Virus AI:** seeded. A virus hunts across W by stepping one layer toward the navi, tracks her row, then telegraphs a row attack.

### Corruption limits

- 1 corruption at most every 200 ticks (10 s).
- 3 per battle at most.
- Each corruption targets a distinct memory from `config.memoryPool`. The server picks the pool from the companion's recent `memory_events`.

### Purify

Purify is a chip, and it only works when clarity is at least 0.8 (tune toward violet). It restores the most recent corruption and cleanses poison on the navi's layer.

## The Serenity signal

`clarityAt(W)` is piecewise-linear between band centres, so there are no detents. It feeds:

- **Chip power** (multiplier shown in the HUD).
- **Comms:** her lines are glitched by `glitchText(…, 1 − clarity)`.
- **Visual noise:** a scanline overlay with opacity `0.35·(1 − clarity)`.
- **Vessel expression:** passed to AnimaVesselMesh.
- **Scene light.**

## Phase-shift (sideways W move)

- **Cost:** `2 + |ΔW|/10` memory. The range is ±45 W.
- **Duration:** `6 + |ΔW|/5` ticks.
- **Intangible while phasing:** this is the dodge, and it is paid for in memory.
- **Through a PhaseGate portal:** the shift is instant and free, and the gate closes behind you.

Rendering:

- a dissolve-shader column at the origin;
- a materialising column in the target band colour;
- an afterimage glyph on the origin layer;
- a band-colour light flash on landing.

Telegraphing:

- the FrequencyTuner sets a **ghost preview** of where the shift lands (ring and glyph on the target layer);
- the W gauge shows every unit's W and the preview;
- virus attacks blink the target panels red for 0.8 s;
- off-layer viruses show as translucent band glyphs.

## Persistent memory (non-destructive)

`memory_events` is never updated or deleted. Corruption and restoration are **appended** events:

- `memory_corrupted` has payload `{target_event_id, severity, band, sim_session_id, tick, expires_at (+7 d)}`.
- `memory_restored` has payload `{target_event_id, …}`.
- `battle_outcome` records each battle's result.

View `memory_corruption_active` holds the latest corruption per target that has no later restore and hasn't expired. `recall_memories` v2 keeps the same signature and does three things with it:

- multiplies a corrupted memory's score by `1 − 0.6·severity`;
- adds `payload.corrupted`;
- never returns the corruption bookkeeping events.

In the prompt, `sessionContext.formatMemoryCoreBlock` replaces a corrupted memory with `obscuredMemory()`, which outputs `[signal corrupted · 60%] we ▓▓▓▓ the ░▒▓ …`. The stored text is untouched. `memory_health` also gains `corrupted_count`.

## Anti-cheat lite

1. **Session setup.** `POST /api/sim/sessions` fixes the seed, the enemies (derived from the node's band and signal type) and the memory pool on the server.
2. **Client play.** The client plays optimistically and sends batches every 2 s, plus one at the end. Each batch is `{from_idx, actions, claimed: {tick, hash}}`.
3. **Server replay.** The server re-runs the whole append-only log with `@workspace/sim-core` (`validateLog`). It checks:
   - action shape;
   - ticks are non-decreasing;
   - at most 3 inputs per tick and 14 per second;
   - log length;
   - the state hash.

   A mismatch returns 409, and the client shows "unverified".
4. **Recording.** Only consequences the replay itself produced are written to `memory_events`. They're dedupe-keyed, so retries are safe.

The actions, a validated snapshot and the one-time session finish are written in one SQL statement. That keeps the write atomic on the Worker driver too, which has no transactions.

## Reuse of the existing 3D stack

- **SerenityFigure** (`components/battle/BattleFigures3D.jsx`) renders the navi through **AnimaVesselMesh**. `lib/sim/vesselModel.ts` maps the companion's saved `VesselConfig` (Vessel Studio) to the `{color, accent, gold, gltf_url}` model those components already take.
- **VirusFigure** renders on-layer viruses. Its silhouette comes from the virus kind, its tint from the band, and a node glyph sits above it.
- **`lib/battleLayout`** places panels and figures, so they share CELL and PANEL sizes with `/net-battle`.
- **useRendererQuality** and **PerformanceMonitor** set the quality tiers, as in NetBattleScene3D.
- **SovereignPresenceStage** opens from the result screen, wrapping AnimaVessel4D. It uses the same vessel model, with expression set by the final clarity.

## Performance (iPad Pro M4)

- All 90 panels are one `InstancedMesh` with per-instance colour, so there are no per-panel React nodes.
- Off-layer entities are simple glyph meshes rather than full figures.
- The canvas uses `frameloop="demand"` while the Custom screen is open or the battle has ended.
- DPR, stars and bloom follow the quality tier.
- The engine is fixed-step at 20 Hz and runs off the render loop, using an interval rather than `useFrame`. The clock pauses when the tab is hidden.
