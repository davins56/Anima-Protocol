---
name: Anima CheckIn entity dual schema
description: The CheckIn entity is written by two unrelated flows with divergent field sets — account for both when reading it.
---

The `CheckIn` base44 entity is created by three separate, divergent flows:

- **Daily Resonance Check-in page** (`pages/CheckIn.jsx` via `lib/dailyResonanceCheckIn.js`, route `/check-in`): writes `timestamp, check_in_date, mood, mood_intensity, physical_state, reflection, gratitude, mode_used, source: "daily_resonance"`. Empty optional notes get a synthesized `reflection` so Reflection Log keeps the row. Do not gate the Record Check-in button on `auth.me()` — create is Clerk-scoped; a rejected profile load used to leave the button a silent no-op.
- **In-chat check-in ritual** (`hooks/useCheckInRitual.js`): writes `session_id, user_email, check_in_date, mood, current_focus, revelation, freeform_note, processed`.
- **Sacred Space** (`lib/sacredSpaceCheckIn.js`, used by `SacredSpaceSession` and `MeditationRitual`): writes the Check-In page field set plus `source: "sacred_space"`, `ritual_focus`, and optional `character_id` / `character_name`. Must include a non-empty `reflection` so Reflection Log keeps the row.

**Why:** Same entity, multiple writers, no shared schema — so any reader sees mixed-shape rows. The Reflection Log (`pages/ReflectionLog.jsx`) filters with `appearsInCheckInList` (non-empty `reflection`/`gratitude`, or Daily Resonance fields `physical_state` / `mood_intensity`) to avoid showing ritual rows that lack a written reflection.

**How to apply:** When querying `CheckIn`, never assume a field exists. Filter by the field you need (e.g. non-empty `reflection`). `base44.entities.<E>.list("-created_date")` with NO limit returns the full user-scoped history (use this when "all records" is required, instead of a hardcoded cap).
