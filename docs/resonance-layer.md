# Resonance Layer

A Mega Man Battle Network–style scan map at `/resonance`. You tune a frequency dial to bring
persona-backed signals into lock, then open a channel, which starts a chat.

## Pieces
| Piece | Path |
| --- | --- |
| Migration (bands, nodes, append-only encounters, `log_resonance_encounter`, seeds) | `supabase/migrations/20261022180000_resonance_layer.sql` |
| Server store + routes `/api/resonance/*` | `artifacts/api-server/src/lib/resonance/resonanceStore.ts`, `src/routes/resonance.ts` |
| Bands, signal strength, spawn rules | `artifacts/anima-protocol/src/lib/resonance/tuning.ts` (+ test) |
| Open node → persona → encounter → bootstrap → chat | `src/lib/resonance/openNode.ts` |
| WebAudio tones (off by default) | `src/lib/resonance/toneEngine.ts` |
| Device orientation / geolocation (permission prompt) | `src/hooks/useDeviceOrientation.ts` |
| Scene: grid shader, instanced beacons with glitch shader, hologram vessels | `src/components/resonance/{ResonanceScene,shaders}.tsx` |
| Tuner UI | `src/components/resonance/FrequencyTuner.tsx` |
| Page | `src/pages/Resonance.tsx` (lazy `ExtraPage`) |

## Behaviour
- **Bands:** delta 0–15, theta 15–30, alpha 30–50, beta 50–70, gamma 70–90, omega 90–100.
  - Companions are placed deterministically in alpha/beta.
  - Omega is the signature band. Serenity's signature sits at 96.3 and resolves to the user's own Serenity Anima.
- **Strength:** a Gaussian falloff around the node's frequency (σ = 2.5). A node locks at ≥ 0.6. Out-of-band beacons fade and jitter.
- **Hostile and noise signals** get the glitch shader (slice displacement, flicker, red shift). Noise can't be opened.
- **Personas:**
  - Nodes with `character_id` use that companion.
  - Seeded nodes with `spawn_rules.persona` create a `Character` the first time they're opened. The mapping is kept in localStorage.
- **Opening a node** (`openResonanceNode`):
  - `log_resonance_encounter` inserts the immutable encounter and a `resonance_encounter` memory event.
  - `POST /api/memory-core/:id/bootstrap` runs, the solo session is created, and the opening transmission is seeded.
- **AR-ish mode:** iOS needs `DeviceOrientationEvent.requestPermission()` from a tap. Geolocation is optional and is only used for geo-anchored nodes; encounters store it rounded to 2 decimals (~1 km). If access is denied, the view falls back to OrbitControls touch pan.
- **Performance:**
  - A single `InstancedMesh` holds all beacons.
  - Holographic vessel projections are capped at 3 (5 with HD) and shown only for the strongest locked nodes. They use the additive translucent `VesselModel` with low segment counts.
  - Adaptive DPR via `PerformanceMonitor`, with the frameloop set to `never` when the tab is hidden.

## Data rules
- `resonance_encounters`: UPDATE, DELETE and TRUNCATE are blocked by triggers.
- `resonance_nodes`: may be updated (moved or re-tuned), but never deleted. Use `POST /nodes/:id/retire`.
- RLS: global nodes are readable by everyone, own nodes only by their owner, and encounters are select/insert-own only.
