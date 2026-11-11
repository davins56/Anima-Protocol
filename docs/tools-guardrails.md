# Companion tools guardrails: schema (feature/tools-guardrails-schema)

Schema only. Migration: `supabase/migrations/20261111020000_tools_guardrails.sql`. No route, chat or Worker code uses it yet. It needs the user's OK to apply, in order after `20261110230000_recall_turn_linkage.sql` and `20261111010000_memory_health_join_scope.sql` if those land first.

## Rules the schema encodes
- **Only an explicit command or button triggers a tool.** `tool_action_log.trigger_kind` is `command` (for example `/search`, `/read <url>`, `/webhook <name>`) or `button`. Plain language, initiative, background and cron have no value to write. The only other value is `settings_test`: a webhook test from Settings, which must have no turn.
- **Every chat-triggered row names its user turn.** It must have `turn_id`, `conversation_id` (= `chat_sessions.id`, as in `memory_events`) and `user_message_id = turn_id || ':user'` (the `chat_turns` convention). The API must take these from the `chat_turns` row its own request created, never from the request body.
- **Per-action order.** Each action has its own `seq`, starting at 1. A BEFORE INSERT trigger requires:
  - the next `seq`, with no gaps or repeats;
  - the same user, companion, conversation, turn, tool and trigger kind as row 1;
  - no event after a terminal one (`succeeded | failed | denied | expired | stopped`);
  - at most one `started` per action;
  - a `started` that follows `confirmation_required` only once that confirmation is `confirmed`.
- **Events:** `started | confirmation_required | progress | succeeded | failed | denied | expired | stopped`. Denials say why in `reason`, for example `not_allowed`, `killed`, `user_denied`, `ssrf_blocked` or `limit`.
- **Append-only.** `anima_forbid_mutation()` blocks UPDATE, DELETE and TRUNCATE on the log, the same as `memory_recalls` and `search_audit`.
- **Confirmations** (`tool_pending_confirmations`):
  - Each row has `target`, `payload_summary`, `amount`/`currency` (required for `purchase`) and `request_hash` (sha256 hex).
  - Rows are created `pending` and change status once. Nothing else can change, including `request_hash`, `payload_summary`, `amount` and `expires_at`.
  - `confirmed` is never allowed at or after `expires_at`, and `expired` only after it. Both checks use `clock_timestamp()`.
  - Rows can never be deleted.
- **Permissions are per companion.** `tool_permissions(user_id, character_id, tool)`. No row, or `allowed = false`, means denied. `confirm_all` can only add confirmations.
- **Kill switches.** The global switch is the Worker setting `ANIMA_TOOLS_KILL`, so there is no table for it, and changing it needs a secret or variable update. The per-user switch is `tool_user_settings.tools_killed`, where no row means not killed.
- **Outside fetches run on the Cloudflare Worker.** `target_host` and `resolved_ip` record the host and the address that was checked. The Worker's `fetch` cannot be pinned to that IP, so a DNS answer can change between the check and the connection. That race is open for security review.
- **RLS.** RLS is on for all four tables.
  - `authenticated` may only SELECT its own action-log rows (`auth.jwt()->>'sub'`), and has no other privilege on these tables.
  - `anon` has none.
  - The API writes through its own DB role.

## What the DB does not prove
- A `started` row is a claim. Nothing in Postgres stops an executor from running a tool without logging it. The `ToolContext` and executor checks in code are still required.
- Attempts from background turns have no turn, so they cannot be logged here. Code must reject them and use app logs.
- Changes to permissions and kill switches are mutable rows with `updated_at`, with no audit trail.
- Each action has one confirmation (`action_id` is UNIQUE). A webpage action that needs several confirmed steps would need one action per step, or a schema change.
- Account deletion conflicts with append-only, the same as for `search_audit` and `memory_recalls`.
