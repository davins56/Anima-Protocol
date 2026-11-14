-- Cyberworld journeys (PR #721): persist companion "I went to X because Y"
-- events in the append-only memory stream. Event types are rows, not a
-- Postgres ENUM, so adding one is a plain INSERT (non-destructive).
INSERT INTO public.memory_event_types (type, description) VALUES
  ('cyberworld_journey', 'a companion journey in the cyberworld: payload {kind, area_id, target_id, activity, reason, motive, journey_event_id}')
ON CONFLICT (type) DO NOTHING;
