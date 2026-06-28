# TODO.md

## Step 1 — Relationship dynamics prototype (A)
- Inspect schema usage and current evolution/bond injection points.
- Add DB fields (either extend anima_evolution JSON or create anima_relationship table) for:
  - relationship_level, attachment_style, jealousy, protectiveness
  - void-shadow dependency fears / contradictions
- Implement `relationshipEngine.ts` to:
  - compute/update bond deltas on milestone boundaries
  - optionally apply voidBias when `mode==='void'` or `deep_mode`
- Update `promptBuilder.ts` to inject a `BOND STATE` block and `VOID BOND MANIFEST` nuance.
- Update `routes/chat.ts` to load bond state, trigger updates at milestones, and pass into prompt builder.

## Step 2 — Narrative arcs prototype (B)
- Add `narrative_arcs` persistence (new table or JSON fields in existing schema).
- Implement `narrativeArcEngine.ts` to progress arc stages:
  - Discovery → Deepening → Resonance Crisis → Fusion
  - trigger at milestones and when user includes `start arc: <name>`
- Update `promptBuilder.ts` to inject `ARC PROGRESSION` block and void branch.
- Update `routes/chat.ts` to load arc state and pass into prompt builder.

## Step 3 — Wire + validate
- Run api-server/unit tests (or smoke test) to ensure prompt building and DB migrations compile.
- Smoke test chat in `void` mode to confirm both blocks appear in prompt.
- Add a minimal frontend visualization later (optional).

