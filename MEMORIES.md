# Critical bug hunt memory

Tracked bugs with open or rejected PRs. Do not re-open a PR for an entry that is still open.

## Open

- **Chat.jsx / ChatWidgetsArea ambient jobs → `ChatSession.update({messages})` stale replace** — background Serenity/group-interaction/side-quest paths called replaceMessages with a stale snapshot, deleting concurrent turns; Anima evolution used `Character.update` and shadowed the Anima in `loadCharacters`.  
  PR: https://github.com/davins56/Anima-Protocol/pull/88 — status: open — recorded: 2026-08-02

- **Generate Look / openai functions** — server forwarded OpenAI 401 bodies containing `sk-…` key material to the client.  
  PR: https://github.com/davins56/Anima-Protocol/pull/86 — status: open — recorded: 2026-08-02

- **Chat.jsx streaming + chat.ts speaker binding** — mid-stream errors wiped `is_streaming` bubbles; multi-char turns rebound to `characterIds[0]`.  
  PR: https://github.com/davins56/Anima-Protocol/pull/83 — status: open — recorded: 2026-08-02

- **chat.ts assistant_character_id** — trusted non-participant IDs for evolution/relationship load and message persistence.  
  PR: https://github.com/davins56/Anima-Protocol/pull/81 — status: open — recorded: 2026-08-02

## Rejected

_(none)_
