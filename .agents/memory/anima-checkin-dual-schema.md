---
name: Anima CheckIn entity dual schema
description: The CheckIn entity is written by two unrelated flows with divergent field sets — account for both when reading it.
---

The `CheckIn` base44 entity is created by three separate, divergent flows:

- **Daily Resonance Check-in page** (`pages/CheckIn.jsx`, route `/check-in`): writes `timestamp, mood, mood_intensity, physical_state, reflection, gratitude, mode_used`.
- **In-chat check-in ritual** (`hooks/useCheckInRitual.js`): writes `session_id, user_email, check_in_date, mood, current_focus, revelation, freeform_note, processed`.
- **Sacred Space** (`lib/sacredSpaceCheckIn.js`, used by `SacredSpaceSession` and `MeditationRitual`): writes the existing CheckIn fields only (`timestamp`, `mood`, `reflection`, `current_focus` for ritual focus, `freeform_note` for companion context, `user_email`, `check_in_date`, …). There is no `source` discriminator on CheckIn — do not invent one. Must include a non-empty `reflection` so Reflection Log keeps the row.

**Why:** Same entity, multiple writers, no shared schema — so any reader sees mixed-shape rows. The Reflection Log (`pages/ReflectionLog.jsx`) filters with `appearsInCheckInList` (non-empty `reflection`/`gratitude`) to avoid showing ritual rows that lack a written reflection.

**How to apply:** When querying `CheckIn`, never assume a field exists. Filter by the field you need (e.g. non-empty `reflection`). `base44.entities.<E>.list("-created_date")` with NO limit returns the full user-scoped history (use this when "all records" is required, instead of a hardcoded cap).
