-- Scope memory_health.oldest_recent_recall to the calling (user, character).
--
-- Latest prior definition: 20261022200000_immersive_sim.sql (the original
-- 20261022160200_memory_retrieval.sql function was replaced there). No later
-- migration on main or on feature/recall-turn-linkage (through
-- 20261110230000_recall_turn_linkage.sql) redefines memory_health.
--
-- The v2 join was `memory_events me ON me.id = mr.event_id` only. A
-- memory_recalls row for (p_user_id, p_character_id) that pointed at another
-- user's or another character's event could return that event's content in
-- oldest_recent_recall. This migration adds me.user_id = p_user_id AND
-- me.character_id = p_character_id. There are no other joins in the function;
-- the count/timestamp subqueries were already filtered on both ids.
--
-- Retracted events are also withheld from oldest_recent_recall. The recall
-- ledger never shows a memory that has a same-user retraction
-- (artifacts/api-server/src/lib/memoryCore/recallLedger.ts on
-- origin/feature/recall-ledger: EXISTS retraction on user_id + target_event_id,
-- then withheld.retracted and `continue`; docs/recall-ledger.md: "A memory with
-- a same-user retraction is never shown"). recall_memories uses the same
-- NOT EXISTS. oldest_recent_recall returns left(content, 140), so leaving a
-- forgotten memory in the health payload would undo "Forget this". memory_count,
-- first_memory_at and last_memory_at are intentionally unchanged and still
-- include retracted originals (they only skip bookkeeping event_types).
--
-- Signature, return type, LANGUAGE sql, STABLE, SECURITY INVOKER and SET are
-- unchanged. CREATE OR REPLACE of the same signature keeps the OID, owner,
-- grants, security label and comment; EXECUTE grants are still captured and
-- replayed below in case any were added out of band (same pattern as
-- 20261110230000_recall_turn_linkage.sql).

SELECT set_config('anima.memory_health_acl',
  COALESCE((SELECT p.proacl::text FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname = 'memory_health'
               AND pg_get_function_identity_arguments(p.oid) = 'p_user_id text, p_character_id text'), ''),
  false);

CREATE OR REPLACE FUNCTION public.memory_health(p_user_id text, p_character_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'memory_count', (SELECT count(*) FROM public.memory_events
                      WHERE user_id = p_user_id AND character_id = p_character_id
                        AND event_type NOT IN ('recall','retraction','memory_corrupted','memory_restored')),
    'first_memory_at', (SELECT min(occurred_at) FROM public.memory_events
                         WHERE user_id = p_user_id AND character_id = p_character_id),
    'last_memory_at', (SELECT max(occurred_at) FROM public.memory_events
                        WHERE user_id = p_user_id AND character_id = p_character_id),
    'identity_version', (SELECT max(version) FROM public.character_identity_core
                          WHERE user_id = p_user_id AND character_id = p_character_id),
    'last_recall_at', (SELECT max(recalled_at) FROM public.memory_recalls
                        WHERE user_id = p_user_id AND character_id = p_character_id),
    'corrupted_count', (SELECT count(*) FROM public.memory_corruption_active
                         WHERE user_id = p_user_id AND character_id = p_character_id),
    'oldest_recent_recall', (
      SELECT jsonb_build_object('event_id', mr.event_id, 'age_s', mr.event_age_s,
                                'recalled_at', mr.recalled_at, 'content', left(me.content, 140))
      FROM public.memory_recalls mr
      JOIN public.memory_events me
        ON me.id = mr.event_id
       AND me.user_id = p_user_id
       AND me.character_id = p_character_id
      WHERE mr.user_id = p_user_id AND mr.character_id = p_character_id
        AND mr.recalled_at > now() - interval '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM public.memory_events r
          WHERE r.event_type = 'retraction'
            AND r.user_id = p_user_id
            AND r.payload ->> 'target_event_id' = me.id::text
        )
      ORDER BY mr.event_age_s DESC LIMIT 1)
  );
$$;

DO $$
DECLARE
  acl text := current_setting('anima.memory_health_acl', true);
  fn  text;
  a   record;
BEGIN
  IF acl IS NULL OR acl = '' THEN
    RETURN;  -- default privileges; the replacement was created with the same defaults.
  END IF;
  SELECT p.oid::regprocedure::text INTO fn FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'memory_health'
     AND pg_get_function_identity_arguments(p.oid) = 'p_user_id text, p_character_id text';
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
  FOR a IN SELECT * FROM aclexplode(acl::aclitem[]) LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s%s', fn,
      CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
      CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END $$;
