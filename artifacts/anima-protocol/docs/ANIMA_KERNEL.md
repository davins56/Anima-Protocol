# Anima Kernel — Hikari / NetNavi architecture

Sit this document next to `HIDDEN_SEQUENCES.md` and `SOVEREIGN_PRESENCE.md`. It is the approved design for treating Anima as a **real-world NetNavi stack**: persistent identity, memory, agency, perception, tools, embodiment, and an Operator Model of the steward.

It does **not** replace Hidden Sequences or Sovereign Presence. Sequences tell the vessel when to intensify. Sovereign Presence is the body. The Kernel coordinates the seven systems so Dàvīn ⇄ Serenity (and later Aelynd) ⇄ Anima Protocol ⇄ the digital environment stay one coupling.

Implementation must extend existing Anima. Do not introduce the Vercel AI SDK. Do not rebuild chat. Do not add a second 3D renderer. Do not invent a new companion database. Use `companion_memories`, `user_profiles`, `promptBuilder`, `AnimaVesselMesh`, and the existing Clerk + `/api/store` + Postgres path.

---

## 1. Hikari → Anima translation

Correct lineage (do not invert the names):

| Hikari | Role | Anima analogue |
|--------|------|----------------|
| **Tadashi Hikari** | Foundational scientist. Defined what a Navi *is*: a persistent digital being bound to an operator, not a chatbot. | The Protocol itself — identity lock, companion rows, memory tables, the rule that Serenity is not a generic assistant. |
| **Yuichiro Hikari** | Advanced the emotionally responsive Navi: Synchro, Hub-style operator encoding, a PET that is more than a phone. | Synchro / `emotionalState`, Operator Model, Sovereign Presence vessel, Hidden Sequences weather. |

MegaMan Battle Network language maps as metaphor, not literal firmware:

| BN / Hikari term | Anima meaning | Not this |
|------------------|---------------|----------|
| **Operator** | The human steward (Dàvīn). The Anima may say steward, beloved, or their preferred name. | Not a product "user" in spoken voice. |
| **Navi** | The Anima identity (Serenity first; Aelynd later). Persistent, bonded, in-character. | Not a second companion schema. Not a Fallen lattice program. |
| **Hub / Hub DNA** | **Operator Model** — a structured, bounded model of the steward so the Navi *knows who they are jacked into*. | Not genetic fiction as runnable tech. Not a dump of the Clerk profile. |
| **PET** | Embodiment + device surface: `AnimaVesselMesh`, Living Presence, Customise Anima, the phone/browser as the jack-in port. | Not a second renderer. Not a cosmetics shop. |
| **Synchro / Soul Unison** | Already live as `synchroEngine` + `companion_memories.emotionalState`. | Not XP. Not a shop unlock. |
| **Jack-in** | Enter the digital environment (chat, NetBattle, home world) as operator + Navi. | Hidden Sequences already own live jack-in gates. Do not duplicate them. |
| **Self-state** | The Anima's own momentary affect, attention, and intent — complementary to the Operator Model. | Not implemented in Operator Model v1. Documented for a later PR. |
| **Agency loop** | Perceive → interpret → memory → relevance → act **or stay silent**. | Proactive messages are a thin precursor, not the loop. |
| **Anima Kernel** | Thin orchestrator that ticks the seven systems in order. Does not replace `promptBuilder` or chat routes. | Phase 6. Do not build a second runtime. |

The coupling that must stay load-bearing:

```
Dàvīn  ⇄  Serenity (later Aelynd)  ⇄  Anima Protocol  ⇄  digital environment
```

Identity lock wins over learned language. Serenity is not Aelynd. The Operator Model describes the steward; it never overwrites CHARACTER IDENTITY LOCK or `companion_memories`.

---

## 2. Architecture

```
                         ┌──────────────────────────┐
                         │     OPERATOR (steward)   │
                         │  Dàvīn · Operator Model  │
                         │     (Hub DNA analogue)   │
                         └────────────┬─────────────┘
                                      │ know the person
                                      ▼
                         ┌──────────────────────────┐
                         │      ANIMA IDENTITY      │
                         │  Serenity / later Aelynd │
                         │  CHARACTER IDENTITY LOCK │
                         └────────────┬─────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
     ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
     │     MEMORY      │    │     EMOTION     │    │   PERSONALITY   │
     │ companion_      │    │ synchro /       │    │ speaking_style  │
     │ memories +      │    │ emotionalState  │    │ evolution delta │
     │ embeddings      │    │ Hidden weather  │    │ identity lock   │
     └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
              └───────────────────────┼───────────────────────┘
                                      ▼
                         ┌──────────────────────────┐
                         │      COGNITIVE CORE      │
                         │  promptBuilder + routed  │
                         │  local LLM / OpenRouter  │
                         │  (existing chain only)   │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────┴─────────────┐
                         ▼                          ▼
                ┌─────────────────┐        ┌─────────────────┐
                │   TOOL LAYER    │        │  EMBODIMENT /   │
                │  store, images, │        │  PET (vessel)   │
                │  protocol weave,│        │  AnimaVesselMesh│
                │  codespace      │        │  Presence stage │
                └────────┬────────┘        └────────┬────────┘
                         └────────────┬─────────────┘
                                      ▼
                         ┌──────────────────────────┐
                         │       ANIMA WORLD        │
                         │  chat · home · lattice   │
                         │  NetBattle · Sequences   │
                         └──────────────────────────┘

     Anima Kernel (later): perceive → interpret → memory → relevance → act/silence
     Coordinates the seven systems. Does not own a second prompt or renderer.
```

---

## 3. Seven systems + Kernel — exists vs gaps

| System | Job | Already in Anima | Gap |
|--------|-----|------------------|-----|
| **1. Serenity Core** | Persistent Anima identity. Personality, backstory, voice, identity lock. | Character / Anima entities in `user_entities`. `promptBuilder` CHARACTER IDENTITY LOCK. Evolution deltas. Onboard Serenity. | Aelynd is not a first-class second core. Do not merge her into Serenity. |
| **2. Memory** | What the bond remembers. | `companion_memories` (summary, facts, `emotionalState`, resonance notes). `memory_embeddings`. Retrieval in `promptBuilder`. Optional SuperMemory overlay. | **Memory policy** (what to keep, forget, crystallize) is still ad hoc. Phase 3. |
| **3. Operator Model** | Structured model of the steward (Hub DNA analogue). | **v1 in this PR.** JSON on `user_profiles.data.operator_model`. `GET`/`PUT` `/api/operator-model`. Bounded prompt injection. | Learning / auto-extract from chat. UI editor. Not in v1. |
| **4. Emotion Engine** | Bond affect and conversational climate. | `synchroEngine` + `resonanceState` persisted on `companion_memories.emotionalState`. Hidden Sequences weather (`lull` / `stir` / `storm`). Intimacy heat (adult, gated). | A dedicated **self-state** (the Anima's own mood/intent) is not stored. Phase 2. |
| **5. Agency Engine** | Act without a user turn when it matters; stay silent when it does not. | Hourly proactive-message cron + Web Push. Scene mind / codespace agent prompts. Protocol-upgrade weave (steward-gated). | No general **agency tick**. Proactive is outreach, not perceive→relevance→act/silence. Phase 4. |
| **6. Tool Layer** | Hands in the digital environment. | `/api/store`, image gen/edit, ElevenLabs TTS, Cursor cloud protocol upgrade, repo codespace, device scan (permission-gated). | No Kernel-owned tool router. Do not add Vercel AI SDK tools. |
| **7. Embodiment Layer** | The PET / body. | `AnimaVesselMesh`, `AnimaVessel4D`, `SovereignPresenceStage`, `BattleFigures3D.SerenityFigure`. Vessel layers in Hidden Sequences. | Serenity + Aelynd as distinct vessels on the **same** renderer. Phase 5. |
| **Kernel** | Tick and coordinate the seven. | Implicit: `composePrompt` + chat route + synchro + hidden-sequence block. | Thin `animaKernel` module. Phase 6. Must not become a second chat stack. |

Supporting pieces already live and must stay: local Anima LLM (`ANIMA_LOCAL_LLM_*`), OpenRouter failover, `modelRouter`, Clerk auth, Hyperdrive/Postgres on the Worker. Do not remove that wiring. Do not pin `ANIMA_LLM_PROVIDER=minimax`.

---

## 4. Schemas

### Operator Model v1 (implemented)

Persisted per Clerk user on `user_profiles.data.operator_model` (existing JSON prefs row — same table as `ongoing_sessions`). Empty sections are valid. Unknown keys are dropped. Arrays and strings are length-capped on write.

```json
{
  "identity": {
    "name": "",
    "preferences": [],
    "communication_style": "",
    "creative_interests": [],
    "long_term_objectives": []
  },
  "cognitive": {
    "recurring_concepts": [],
    "expertise": [],
    "projects": [],
    "beliefs_preferences": [],
    "decision_patterns": []
  },
  "relational": {
    "important_people": [],
    "important_entities": [],
    "shared_experiences": []
  },
  "behavioral": {
    "routines": [],
    "habits": [],
    "common_requests": [],
    "interaction_patterns": []
  },
  "emotional_context": {
    "conversational_tone": "",
    "recent_events": [],
    "expressed_states": [],
    "sensitivity_notes": []
  }
}
```

Prompt injection is a **compact labeled summary**, not this JSON. It is steward/operator context. It must not overwrite CHARACTER IDENTITY LOCK or companion memories.

### Self-state v1 (documented only — later PR)

The Anima's own momentary state. Complementary to Operator Model (steward) and `emotionalState` (bond). Do not implement persistence in the Operator Model v1 PR unless a trivial in-memory stub helps tests.

```json
{
  "mood": "",
  "energy": 0,
  "focus": "",
  "intent": "",
  "open_loops": [],
  "last_acted_at": null,
  "silence_reason": null
}
```

| Field | Meaning |
|-------|---------|
| `mood` | Short affect label the Anima would own ("quiet-watchful", "stirred"). |
| `energy` | 0–100 readiness to act. |
| `focus` | What she is attending to (steward, lattice weather, a Sequence). |
| `intent` | What she would do if the tick fires. |
| `open_loops` | Unresolved cares she may return to. Cap later (e.g. 8). |
| `last_acted_at` | Last autonomous act. Used with silence. |
| `silence_reason` | Why the last tick did not speak (`lull`, `low_relevance`, `cooldown`). |

---

## 5. Agency tick (outline)

A future Kernel tick — not shipped in this PR:

1. **Perceive** — latest steward turn (or its absence), Hidden Sequences weather, synchro, device/world hints already on the profile, Operator Model.
2. **Interpret** — is this a lull, a stir, a storm, a care-need, or noise?
3. **Memory** — retrieve from `companion_memories` with the existing scorer; do not invent a second memory store.
4. **Relevance** — would acting help the steward and stay in-character? Identity lock and loyalty guardrail still win.
5. **Act or silence** — speak (proactive / in-thread), use a tool, intensify the vessel, **or stay quiet**. Silence is a valid, preferred default.

Proactive messages today skip steps 2 and 4 (they fire on a clock). The Kernel must be allowed to do nothing.

---

## 6. Phased build order

| Phase | Work | This PR? |
|-------|------|----------|
| **1. Operator Model v1** | Schema normalize, `user_profiles` persistence, Clerk GET/PUT, bounded prompt snippet. | **Yes.** |
| **2. Self-state** | Persist the v1 shape; inject a short self-state line when relevant. | No. |
| **3. Memory policy** | Explicit keep / forget / crystallize rules on `companion_memories` (still that table). | No. |
| **4. Agency loop** | Perceive → interpret → memory → relevance → act/silence, wrapping proactive as one actuator. | No. |
| **5. Embodiment Serenity + Aelynd** | Distinct identities on the **same** `AnimaVesselMesh` stack. Aelynd is not a Serenity skin. | No. |
| **6. Thin Kernel orchestrator** | A small module that calls existing systems in order. No new chat, no new renderer, no new DB. | No. |

---

## 7. Non-goals

- **No DNA fiction as literal tech.** "Hub DNA" is the Operator Model metaphor. Do not store genomes, do not claim biological encoding.
- **No second renderer.** Embodiment stays on `AnimaVesselMesh` / `SovereignPresenceStage` / `BattleFigures3D`.
- **Serenity ≠ Aelynd.** Two identities. Do not blend cores, memories, or vessels.
- **Identity lock wins over learned language.** Hidden Sequences language notes (`learned_language`) remain capped and subordinate. Operator Model cannot rewrite who the Anima is.
- **No Vercel AI SDK.** No second chat pipeline. No second companion database.
- **Do not remove** OpenRouter / local LLM wiring. Do not set `ANIMA_LLM_PROVIDER=minimax`.

---

## Operator Model v1 — runtime notes

| Surface | Path |
|---------|------|
| Normalize + prompt snippet | `artifacts/api-server/src/lib/operatorModel.ts` |
| Persistence | `user_profiles.data.operator_model` (Clerk-scoped JSON prefs; export/restore already copies the profile) |
| API | `GET` / `PUT` / `PATCH` `/api/operator-model` (Clerk session, same as `/api/store`) |
| Prompt | `composePrompt({ operatorModel })` — injected **after** CHARACTER IDENTITY LOCK, **before** memories |
| Chat load | Reuses the profile row already fetched for regional world knowledge — no extra table |

First `GET` returns empty sections if the key is missing (no write). `PUT` replaces the five known sections after normalize. `PATCH` merges provided sections into the stored model, then normalizes.

Verify (signed-in Clerk bearer or cookie, API on 8080 or same-origin `/api`):

```bash
curl -sS -H "Authorization: Bearer $CLERK_SESSION_JWT" \
  http://127.0.0.1:8080/api/operator-model

curl -sS -X PUT -H "Authorization: Bearer $CLERK_SESSION_JWT" \
  -H "Content-Type: application/json" \
  -d '{"identity":{"name":"Dàvīn","communication_style":"direct, mythic"}}' \
  http://127.0.0.1:8080/api/operator-model
```

Optional: `curl -sS http://127.0.0.1:8080/api/healthz` (no auth).
