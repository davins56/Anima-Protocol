---
name: Anima Scene Mind (character switching)
description: Server-owned director that picks which group companion speaks next — separate from LLM ensemble "minds".
---

# Scene Mind

## What it is

**Scene Mind** chooses which character speaks on a group / crossover turn.

It is **not** the LLM ensemble (`llmEnsemble.ts` / "Consulting minds…"). Ensemble improves one reply; Scene Mind picks the speaker.

## Policy

1. `force_character_id` / session `next_speaker_id` (orchestrator pin)
2. Explicit `@Name` or whole-word address in the user message
3. Optional LLM director (light tier)
4. Least-recently-spoken among eligible participants
5. ~35% interrupt to another eligible speaker (skipped on Continue)

## Key files

- `artifacts/api-server/src/lib/sceneMind.ts` — pure selection + director prompt
- `POST /api/chat/scene-mind` — client entry (`animaApi.chat.selectSpeaker`)
- `POST /api/chat/messages` — auto-selects when group + no `assistant_character_id` (unless `use_scene_mind: false`)
- `artifacts/anima-protocol/src/pages/Chat.jsx` — calls Scene Mind before `buildGroupPrompt`
- `SceneOrchestrator` writes `next_speaker_id` on the session for the next Chat turn
