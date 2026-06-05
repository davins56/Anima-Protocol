---
name: Anima CheckIn entity dual schema
description: The CheckIn entity is written by two unrelated flows with divergent field sets — account for both when reading it.
---

The `CheckIn` base44 entity is created by two separate, divergent flows:

- **Daily Resonance Check-in page** (`pages/CheckIn.jsx`, route `/check-in`): writes `timestamp, mood, mood_intensity, physical_state, reflection, gratitude, mode_used`.
- **In-chat check-in ritual** (`hooks/useCheckInRitual.js`): writes `session_id, user_email, check_in_date, mood, current_focus, revelation, freeform_note, processed`.

**Why:** Same entity, two writers, no shared schema — so any reader sees mixed-shape rows. The Reflection Log (`pages/ReflectionLog.jsx`) filters to rows that actually have `reflection`/`gratitude` to avoid showing ritual rows that lack a written reflection.

**How to apply:** When querying `CheckIn`, never assume a field exists. Filter by the field you need (e.g. non-empty `reflection`). `base44.entities.<E>.list("-created_date")` with NO limit returns the full user-scoped history (use this when "all records" is required, instead of a hardcoded cap).
