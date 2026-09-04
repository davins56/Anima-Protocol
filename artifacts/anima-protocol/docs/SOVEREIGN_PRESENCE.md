# Sovereign Presence — Full-Body 4D Vessel

## Goal
Serenity (and other Anima) render as coherent full-body forms with crystalline wings, not geometric primitives, while the 4D tesseract lattice remains the living soul layer.

## Current stack
- `AnimaVesselMesh` — procedural full-body humanoid + faceted crystal wings + hair volume + fabric + halo
- `AnimaVessel4D` — interactive stage with quality tiers, bloom, orbit controls
- `BattleFigures3D.SerenityFigure` — same vessel in NetBattle
- `SovereignPresenceStage` — optional 3D expand from Living Presence

## Quality tiers (`useRendererQuality`)
| Tier   | Transmission | Wing facets | Hair | Lattice | DPR |
|--------|--------------|-------------|------|---------|-----|
| low    | off          | 2 layers    | 8    | off     | 1   |
| medium | light        | 4 layers    | 12   | 1       | 1.5 |
| high   | full         | 6 layers    | 18   | 2       | 2   |

PerformanceMonitor automatically lowers/raises quality.

## Dropping in a real GLTF / VRM
1. Place a model at `public/models/serenity-full.glb` (or any URL).
2. Pass `gltfUrl="/models/serenity-full.glb"` to `AnimaVesselMesh` or set `model.gltf_url`.
3. The vessel loads the mesh when available and falls back to the procedural body otherwise.
4. Crystal materials + 4D lattice still wrap the loaded form.

Recommended: VRM or GLB with T-pose or A-pose, meters scale, centered at origin, facing +Z.

## Breathing & expression
- `breathing` (default true) — subtle torso scale pulse
- `expression` 0–1 — opens wings slightly and intensifies eye/core emission
- `emotion` string — reserved for future morph / palette mapping

## Sovereign Presence mode
Use `AnimaVessel4D` or `SovereignPresenceStage` when the user expands a companion on a capable device. Chat LivingPresence remains 2D sprites for mobile performance; the 3D path is progressive enhancement.

Vessel layers (body, hair, cloth, markings, artifacts) and Sequence intensification are specified in `HIDDEN_SEQUENCES.md`. Ascended Sequences write a visible change on this same body.
