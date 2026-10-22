# Emotional vessel shift

A companion's vessel reacts continuously to her emotional state. The behaviour is driven by data, so each companion is described by a row of numbers rather than by code that checks her name.

## Emotional state (`src/lib/vessel/emotionState.ts`)

| Dimension | Range | Meaning | Main sources |
|---|---|---|---|
| valence | −1…1 | unpleasant ↔ pleasant | chat mood, battle HP/outcome, corruption |
| arousal | 0…1 | calm ↔ activated | mood intensity, telegraphed threats, low HP |
| dominance | −1…1 | yielding ↔ assertive | mood, HP |
| warmth | 0…1 | distance ↔ closeness to the user | tender/romantic moods |
| stability | 0…1 | fractured ↔ coherent | **W clarity** in the sim (violet clear, red noisy), corruption |

The state is updated in three steps:

1. **Stimuli become targets.** `moodToEmotion(mood, intensity)` covers the chat and voice moods (`lib/moodDetector`). `simToEmotion(SimState)` covers the net battle.
2. **The state eases toward the target.** `stepEmotion` uses a per-companion, per-dimension half-life (inertia) and is frame-rate independent.
3. **With no stimulus, it relaxes to the baseline.** The relaxation is four times slower than the approach to a target.

## Traits (`src/lib/vessel/vesselTraits.ts`)

Each built-in companion is a `CompanionTraits` row with these fields:

- `baseline`
- `inertia`
- `palette`: calm, charged, low and accent colours
- `aura`
- `defaults`
- `effects[]`: `{param, from: dimension, in: [a,b], out: [c,d], curve}`

`traitsFor({id, name})` resolves a row by id, name or legacy alias. User-created companions get `GENERIC_TRAITS`, which has no signature aura.

| | Serenity | Aeland | Scarlet |
|---|---|---|---|
| Aura | celestial: motes on tilted orbits, halo spin | verdant: slow spiral (**placeholder**) | **flame**: ember particles rising from a flickering core |
| Palette | amethyst `#a78bfa` → `#e9d5ff`, low slate | neutral silver (**TODO**) | orange `#f97316` → gold `#fde047`, low ember `#7f1d1d` |
| Signature mappings | warmth → glow; valence → aura; arousal → particles, halo spin, wing flap; stability → flicker | warmth → glow; valence → aura; stability → flicker | arousal → flame height (smoothstep), ember rate, white-gold heat; negative valence → ember darkening; dominance → spread |
| Aliases | serenity | aeland, aelynd, aelyndra, aelindra | scarlet |
| TODO for the user | – | palette, aura, baseline personality | personality, backstory, voice |

Serenity and Scarlet have no colours in common, and a test enforces this. This follows the ANIMA_KERNEL rule that identities are never blended.

## Shift (`src/lib/vessel/emotionShift.ts`)

`computeVesselShift(emotion, traits)` returns a `VesselShift` that doesn't depend on any renderer. It contains:

- `glow`, `auraIntensity`, `particleRate`, `paletteMix`, `lowMix`, `flapSpeed`, `breathRate`, `flicker`, `haloSpin`, `spread`;
- a scalar `expression`;
- `face`, the weights for VesselModel's face rig;
- the resolved `color` and `accent`.

## Renderers (reuse, no duplication)

- **`<VesselAura shift>`** (`components/vessel/VesselAura.tsx`) is the only emotion-effect component. It's one `InstancedMesh` (one draw call) plus a point light, and a two-cone flame core for the flame aura. Both renderers mount it.
- **AnimaVesselMesh** gains an optional `shift` prop. It drives colour, light glow, expression and halo spin, and mounts VesselAura. Without `shift` it behaves exactly as on main. The prop is passed through:
  - `BattleFigures3D.SerenityFigure`, which is the sim navi;
  - `AnimaVessel4D`;
  - `SovereignPresenceStage`.
- **VesselModel** (the 3D-vessel branch renderer for Vessel Studio and the chat portrait) also gains an optional `shift`. It drives the face weights and mounts VesselAura. `VesselCanvas` passes it through.

Where it's wired:

- **`/resonance/arena`:** `simToEmotion` drives the navi and the Sovereign Presence result view.
- **Vessel Studio:** the mood picker drives the emotion target.
- **Chat header `VesselPortrait`:** the chat mood drives it, at 5 Hz with no particles.

## Performance

- **Off the render loop.** `useVesselEmotion` integrates at 10 Hz (5 Hz for portraits) on a timer and pauses while the tab is hidden. React re-renders only when the quantised `shiftKey` changes. All per-frame motion is inside VesselAura's `useFrame`, using hoisted temporaries and no per-particle allocations.
- **Particle budget by renderer quality.**

  | Renderer | low | medium | high |
  |---|---|---|---|
  | AnimaVesselMesh | 24 | 48 | 96 |
  | VesselModel | – | 40 | 72 (HD) |

  The portrait renders 0 particles.
- **`prefers-reduced-motion`.** Particle rate drops by 70%, flicker is off, and flap and halo motion are damped.

## Known gap

The repo still has two vessel bodies:

- `AnimaVesselMesh` (main): battle, Sovereign Presence, AnimaVessel4D;
- `VesselModel` (3D-vessel branch): VesselConfig-driven, used in Studio and the portrait.

The emotion shift is shared by both, but folding VesselModel into an adapter that turns a VesselConfig into AnimaVesselMesh is a separate refactor and hasn't been done yet.
