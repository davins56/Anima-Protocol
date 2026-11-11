-- Companion roster: Scarlet resonance node placeholder (additive, idempotent).
-- No columns renamed and no stored rows mutated. Aeland's legacy spellings in
-- user_entities / character_identity_core stay as they are; the app appends
-- a new identity version named 'Aeland' via append_identity_version().
--
-- character_id is NULL: the client resolves persona_hint 'scarlet' to the
-- user's own Scarlet Anima (creating her from the built-in template on first
-- open), exactly like Serenity's signature node.
INSERT INTO public.resonance_nodes
  (user_id, character_id, label, band, frequency, signal_type, is_signature, position, spawn_rules, created_by, seed_key)
VALUES
  (NULL, NULL, 'Scarlet · ember signal', 'gamma', 81.5, 'companion', false,
   '{"x":5,"y":0,"z":-7}',
   '{"persona_hint":"scarlet","placeholder":true,"note":"TODO(user): tune Scarlet''s spawn rules (hours/chance/geo)"}',
   'system', 'global:scarlet-ember')
ON CONFLICT DO NOTHING;
