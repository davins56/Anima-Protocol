# Immersive sim — 3D game loop (`/sim`)

The playable layer on top of `@workspace/sim-core` (deterministic 4D net-battle
engine) and the existing R3F vessel/battle components. sim-core stays the only
source of truth for rules; the frontend decides **when** to step it, **what
inputs** to feed it, and **how to show** what happened.

```
 keyboard / gamepad / taps / dial / tilt / autopilot
                │  SimAction
                ▼
        InputQueue (pending)  ── rate limits = validateLog's (3/tick, 14/s)
                │  drained on tick boundary, stamped {tick, action}
                ▼
 useFrame(-10) → FixedStepLoop.update(dt)  ── accumulator, 50 ms ticks,
                │                              ≤5 catch-up steps, pause on hidden
                │  advance(curr, N) → step(·, {tick:N, a}) …   (= sim-core replay)
                ▼
     prev / curr SimState + alpha ──► render interpolation (useFrame, refs)
                │ events
                ▼
     SimFxStore (tracers, impacts, flinch, corruption, purify …) ──► 3D FX + HUD
                │ stamped log
                ▼
     ActionFlusher → POST /api/sim/sessions/:id/actions {from_idx, actions, claimed:{tick,hash}}  (optional)
```

## Files

| Path (under `artifacts/anima-protocol/src/`) | Role |
| --- | --- |
| `lib/simClient/fixedStepLoop.ts` | Fixed-timestep driver: accumulator, clamped catch-up, `prev`/`curr`/`alpha`, `beforeTick` hooks, `verifyReplay()` |
| `lib/simClient/inputQueue.ts` | Tick-stamped input queue + stamped log; mirrors `validateLog` rate limits; coalesces streamed phase targets |
| `lib/simClient/frequency.ts` | Band lookup, dial/tilt → phase-shift target (±45, 0.1 resolution, dead zone, settle) |
| `lib/simClient/keymap.ts` | Key/gamepad → intent |
| `lib/simClient/gridNav.ts` | Grid collision: standable panels, occupants, BFS paths for taps |
| `lib/simClient/autopilot.ts` | Deterministic "Auto" pilot (inputs go through the same queue/log) |
| `lib/simClient/wSpace.ts` | W → world (ring layout), pose interpolation, phase progress, dissolve curve |
| `lib/simClient/fx.ts` | sim events → transient FX descriptors |
| `lib/simClient/remote.ts` | Optional `/api/sim` session + incremental flusher (fails soft to offline) |
| `lib/simClient/demo.ts` | Offline practice config + demo memory labels |
| `components/simGame/SimArena.tsx` | Page-level wiring: loop, input, dial/tilt, autopilot, server sync, HUD, canvas |
| `components/simGame/SimScene3D.tsx` | Canvas: loop driver, W camera, band atmosphere + post FX, layers, units, FX |
| `components/simGame/SimArena3D.tsx` | Five layer arenas, panel materials, telegraphs, resonance nodes, layer-masked tap handler |
| `components/simGame/SimUnits3D.tsx` | Navi (`SerenityFigure` → `AnimaVesselMesh`) and viruses (`VirusFigure`) with dissolve + afterimages |
| `components/simGame/SimFx3D.tsx` | Tracers, impacts, terrain bursts, PhaseGate portals, Purify, corruption cage, W-lattice |
| `components/simGame/dissolve.ts` | `onBeforeCompile` noise-dissolve injected into existing materials (chains existing hooks) |
| `components/simGame/resonancePicker.ts` | Explicit `Raycaster` on a dedicated `THREE.Layers` channel for resonance nodes |
| `components/simGame/SimHud.tsx` | HP / memory meter / custom gauge / hand, W readout, corrupted memories, flashes, Custom screen |
| `pages/SimGame.tsx` | `/sim` route |

Existing components reused unchanged except `VirusFigure`, which gained an
optional `anchored` prop (render at the parent's origin, like `SerenityFigure`)
so the loop can place it from interpolated sim state.

## The loop

* `FixedStepLoop.update(dtMs)` runs from a `useFrame` with priority `-10`
  (before every other frame callback). Real time accumulates; each 50 ms
  (`TICK_MS`) produces one tick. Frame deltas are clamped (250 ms) and at most
  5 ticks are simulated per frame; any further backlog is dropped and counted
  (`droppedTicks`) rather than spiralling.
* Tick *N* = `advance(curr, N)` then `step(state, {tick: N, action})` for each
  input stamped *N* — the same calls `replay()` makes, so the client's
  `stateHash` equals the server's replay hash (`verifyReplay()`, and tested via
  `validateLog`).
* Rendering interpolates between `prev` (tick N-1) and `curr` (tick N) with
  `alpha = accumulator / 50`. Phase-shift progress uses fractional render
  time, so the shift is smooth at any frame rate.
* `document.hidden` (and the Pause button) pauses the loop and zeroes the
  accumulator: no catch-up burst on return.

## Controls

| Input | Action |
| --- | --- |
| ←↑→↓ / WASD | move one panel (player half, cols 0–2) |
| Z / Space | buster |
| X | use first chip in hand |
| C | open Custom (when gauge full); in Custom: 1–5 toggle, Enter/C load |
| P | Purify (needs a Purify chip in hand and clarity ≥ 80%) |
| Q / E, `[` / `]` | phase-shift down / up to the neighbouring layer's centre |
| Tab | Auto ↔ Manual |
| Tap panel (own layer) | walk there (BFS around broken panels) |
| Tap enemy-side panel | line up on that row, then buster |
| Tap another layer's arena or its resonance node | phase-shift toward that layer (clamped to ±45 W) |
| Frequency dial | continuous aim; commits a phase-shift after 350 ms at rest |
| Tilt (button, mobile) | device gamma ±35° → ±50 W around the W at enable time, feeds the dial |
| Gamepad (standard) | A buster · B chip · X custom · Y purify · LB/RB phase · d-pad/left stick move · Back auto |

Inputs are only *queued*; they apply on the next tick boundary.

## 4D: the frequency axis

* The five layers (noise · ambient · data · rare · serenity, sim-core `BANDS`)
  are full 6×3 arenas placed side by side around a convex ring — the dial
  laid out in space, red left → violet right. `wSlot(w)` maps W to a continuous
  layer slot (exact at layer centres), `wFrame` gives the arena origin + yaw.
  Neighbours recede in depth and turn away; fog hides the far ones.
* A phase-shift slides the unit (and the camera rig, which lives in
  arena-local space) along the ring from source to target plane. The navi
  dissolves out at the source over the first half (fully gone at the midpoint,
  when sim-core also makes it untargetable), leaves additive afterimages along
  the path, and re-materialises at the target. The dissolve is a noise
  threshold with a band-coloured burning edge, injected via `onBeforeCompile`
  into the vessel's own materials (physical crystal, drei transmission,
  emissive) — no duplicate mesh.
* The navi's exact W drives: fog/background tint, bloom (clarity), film noise
  and chromatic aberration (1 − clarity), hemisphere light tint, and the XW
  rotation of a tesseract lattice (one full turn across the spectrum).

## Consequences on screen

* Hits: tracer from attacker to the hit cell + impact ring; `damage` → flinch on
  `SerenityFigure` / `VirusFigure`; `hpRatio` from state dims the figure.
* Terrain: cracked (crack lines), broken (open hole with red rim, not
  tappable for movement), poison (pulsing magenta), holy (gold glow column);
  telegraphed strikes pulse red faster as they approach.
* PhaseGate: rings at both ends and a beam across W-space until `closesAt`.
* Memory: HUD meter (flashes on drain); `memory_corrupted` → red static cage
  around the navi, full-screen glitch overlay, post-FX aberration/noise spike,
  and the memory's label shown through `glitchText` until restored.
  The underlying memory is never modified (sim-core / server append-only model).
* Purify: violet column + halo; restored memories show clean with ✓.
* Virus deletion: dissolve-out + shard burst.

## Physics decision

No rigid-body engine. sim-core is a discrete grid game: every unit occupies
one panel, movement is a whole-panel step validated by the engine (bounds,
player half, broken panels; landing on a broken panel relocates), and attacks
are resolved instantly on cells (rows, columns, layers). A rigid-body
simulation would add a second, floating-point, frame-rate-dependent source of
truth that the server cannot replay, for no gameplay gain. So:

* **Collision** = grid occupancy and standability (`gridNav.ts`), mirroring
  sim-core's rules for UI previews and tap pathing; sim-core rejects anything
  illegal.
* **Projectiles** are visual tracers between the attacker's and target's
  cells, spawned from `hit` events; they never decide a hit.
* **Picking** = raycasting: R3F pointer events for panels, and an explicit
  `Raycaster` limited to a dedicated `THREE.Layers` channel for resonance
  nodes (panels or vessels in front can't steal the tap).

## Server sync (optional)

`/sim?online=1` calls `POST /api/sim/sessions` and, on success, plays the
server-issued config (seed, memory pool). Every 2 s and at battle end it posts
`{from_idx, actions, claimed: {tick, hash}}`; the server replays with sim-core
`validateLog` and records consequences. Any failure (offline, 401, 404 before
the migration) keeps the battle running locally; HUD shows the sync status.
Without `online=1` it is an offline practice battle and nothing is recorded.

## Run locally

```bash
pnpm install
pnpm --filter @workspace/anima-protocol dev
# open http://localhost:5173/sim            (offline practice, random seed)
#      http://localhost:5173/sim?seed=42&w=60
#      http://localhost:5173/sim?online=1   (needs api-server with the sim routes)
pnpm --filter @workspace/anima-protocol test -- src/lib/simClient src/components/sim
```

`/sim` lives inside `ProtocolApp`, so it needs the app shell to boot (Clerk).

## Known gaps

* Overlaps with `feature/immersive-sim`'s own `/resonance/arena`
  (`pages/SimArena.tsx`, `components/sim/*`, `lib/sim/useSimBattle.ts`, which
  steps sim-core from a `setInterval`). This layer lives in separate folders
  (`components/simGame/`, `lib/simClient/`) so both coexist; converging them
  (e.g. driving `/resonance/arena` from `FixedStepLoop`) is a follow-up.
* Remote mode assumes the `/api/sim` contract in that WIP (`from_idx`,
  `claimed`); no resume of a half-flushed session after reload.
* Afterimages use a simplified vessel silhouette, not a clone of the full mesh.
* Resonance nodes are per-layer (phase targets), not the persona-backed nodes
  from the resonance scan map.
* The navi model is a default Serenity palette; wiring the companion's saved
  vessel (`useCharacterVessel`) is a follow-up.
