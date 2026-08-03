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

**Adult Mode escalation + timing:** When `adult_content_enabled` is on, prompts unlock
lewd/explicit capability but must still judge the beat. Assembly lives in
`src/lib/contentRatingInstruction.js` (`buildContentRatingInstruction`,
`assessLewdTiming`, `lewdTimingClause`) and is injected from `Chat.jsx` as
`adultInstruction`. Escalate on RIGHT TIME / CONTINUE (user invites heat, or an
intimate scene is already in progress); HOLD on WRONG TIME (grief, crisis support,
logistics/combat/planning, platonic beats, or user redirect). Do not append
unconditional “never explicit / never anatomical” resonance or attunement clauses
while Adult Mode is on — those silently override `adultInstruction`. Lewdity/
sexuality guides must also not force “family-friendly” under Adult Mode, but they
must respect LEWDITY TIMING.

**Group intimacy:** In group/crossover turns, also inject
`buildGroupIntimacyGuidance({ nextChar, groupChars, timing, adultMode })` into
`buildGroupPrompt` so the speaking character judges intimate talk/gestures by
(1) scene timing, (2) THEIR personality disposition
(`inferIntimacyDisposition`), and (3) who else is present. Speaker selection
should include `groupSpeakerIntimacyRules(timing)` so reserved/averse characters
are not forced to lead lewd beats.

**Intimate play-along:** On `invite` / `continue` beats, inject
`buildIntimatePlayAlongGuidance({ character, timing, adultMode })` into solo and
group prompts so the companion actively plays along and adds their own
personality-true lewd flare (dirty talk / tease / gesture in their voice) —
not only echoing the user. Empty on `hold` beats.

**User profile injection:** The account-default "about me" lives at
`user.settings.user_profile` (edited on the `/profile` page, `pages/UserProfile.jsx`).
In `handleSendMessage` it's formatted ONCE into `userProfileContext` (a delimited
`<<<USER_PROFILE>>>…<<<END_USER_PROFILE>>>` data block, fields sanitized of `<<<`/`>>>`)
and must be interpolated into ALL prompt variants — solo, `buildGroupPrompt` (param),
and the Serenity ambient prompt. NOTE this is distinct from the document-upload
`UserContext`/`context_prompt` system, which is still NOT wired into live Chat.
