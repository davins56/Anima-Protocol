# Companion affect (self-state v1)

Companions have a **felt state** that is distinct from bond synchro:

| Layer | Owns | Lives at |
|-------|------|----------|
| Operator Model | The steward | `user_profiles.data.operator_model` |
| Synchro / resonance | The *bond* | `companion_memories.emotional_state` vector + `synchroStrength` |
| **Self-state / companion affect** | The companion's *own* feeling | `companion_memories.emotional_state.selfState` |

This is Kernel Phase 2. It is not a mood-menu UX. Resonance Keys (Upgrade v2) must **radiate from this felt state**. Choices will tune the Key later; do not add a second mood source when Keys land.

## Wire contract

SSE `done` on `POST /api/chat/messages` and `GET /api/chat/memories/:characterId` both carry:

```json
{
  "version": 1,
  "primary": "tender",
  "intensity": 58,
  "mood": "tender-aching",
  "energy": 44,
  "focus": "steward",
  "intent": "comfort",
  "updated_at": "2026-09-14T12:00:00.000Z",
  "synchro_strength": 61
}
```

`GET /api/chat/sessions/:id/context` returns the same snapshots as `companion_affect` keyed by character id.

The chat toolbar mood chip reads `primary` (+ intensity glow). The Resonance Field prefers `synchro_strength` when present.

`synchro_strength` is the same bond number `serializeSynchroState` writes as root `synchroStrength`. Read it with `synchroStrengthFromEmotionalState` (also used by Key radiation) so a nested `vector` or wire `synchro_strength` cannot fork a second source.

## Update loop

1. Load `selfState` with synchro (before prompt compose — not before the first SSE heartbeat).
2. Evolve from the user turn (heuristics, no extra LLM).
3. Inject a budgeted `SELF-STATE` block (`promptBuilder`, 480 chars).
4. After the reply, evolve from the companion's own words and persist in the existing relationship post-process (after `done`).

Latency slices #453 / #455 stay untouched: stream still opens before context load; post-process still runs after `done`.

## Key radiation hook

Do not implement the Twelve Resonance Keys here. Consume this event later:

```ts
import {
  radiationEventFromAffect,
  radiationEventFromEmotionalState,
} from "./companionAffect";

const event = radiationEventFromEmotionalState(emotionalState);
// or: radiationEventFromAffect(state, synchroStrengthFromEmotionalState(emotionalState))
// { source: "companion_affect", version: 1, felt_at, primary, intensity,
//   valence, arousal, synchro_strength, mood }
```

Client mirror: `artifacts/anima-protocol/src/lib/companionAffect.js` → `radiationEventFromAffect(snapshot)`.

Files: `artifacts/api-server/src/lib/companionAffect.ts`, `artifacts/anima-protocol/src/lib/companionAffect.js`.
