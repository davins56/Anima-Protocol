---
name: Anima auto-generated entity dedupe
description: Why client-side dedupe for auto-created Anima entities (Book of Echoes, etc.) is only best-effort.
---

Auto-generated companion entities written during chat (e.g. `BookOfEcho` journal
entries) are deduped with a client-side `useRef` guard plus a read-then-create
check (filter newest row, compare a stored `message_count`/bucket before writing).

**Why:** the base44 schemaless store has **no unique constraints or atomic
upserts**, so two tabs/devices hitting the same trigger bucket can both pass the
read and both create — duplicates are possible across concurrent clients. The ref
only protects a single client/session.

**How to apply:** treat this dedupe as best-effort, not a guarantee. When writing
a new auto-generator: always make the "first entry" case explicit (a `lastCount`
defaulting to 0 plus a `len - lastCount < N` gate will silently skip the very
first entry unless you guard with `lastCount > 0`). If true idempotency is ever
required, derive a deterministic key from `session_id:bucket` and have the server
enforce it — the client alone cannot.
