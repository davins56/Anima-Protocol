---
name: Anima chat prompt path
description: Which file actually builds the AI system prompt for chat in the anima-protocol artifact, and where content-rating/maturity is injected.
---

# Anima chat prompt path

The **live** AI prompt assembly for chat is in `artifacts/anima-protocol/src/pages/Chat.jsx`,
inside `handleSendMessage`. It builds three prompt variants from a shared
`adultInstruction` string (defined once in that function): solo character prompt,
group prompt (via `buildGroupPrompt`), the "continue story" group fallback, and a
separate Serenity ambient prompt. All go out through `base44.integrations.Core.InvokeLLM`.

`src/lib/chatMessageHandler.js` (`sendChatMessage`) looks like a parallel implementation
but is **dead code — it is never imported anywhere**. Editing it has no runtime effect.

**Why:** A request to make the "18+ / `adult_content_enabled`" toggle govern AI behavior
could be wrongly applied to `chatMessageHandler.js` and appear to do nothing.

**How to apply:** For any change to how the chat AI talks/behaves (tone, content rating,
length, persona), edit `Chat.jsx handleSendMessage`. The content-rating toggle lives at
`user.settings.adult_content_enabled` (set in `src/pages/Settings.jsx` Content Rating
section) and is injected as the `adultInstruction` block — keep ON (permit explicit) and
OFF (enforce safe/non-explicit) branches in sync across every prompt variant.

**User profile injection:** The account-default "about me" lives at
`user.settings.user_profile` (edited on the `/profile` page, `pages/UserProfile.jsx`).
In `handleSendMessage` it's formatted ONCE into `userProfileContext` (a delimited
`<<<USER_PROFILE>>>…<<<END_USER_PROFILE>>>` data block, fields sanitized of `<<<`/`>>>`)
and must be interpolated into ALL prompt variants — solo, `buildGroupPrompt` (param),
and the Serenity ambient prompt. NOTE this is distinct from the document-upload
`UserContext`/`context_prompt` system, which is still NOT wired into live Chat.
