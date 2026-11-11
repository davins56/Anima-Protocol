# Anima voices (voice fingerprints)

Every Anima should sound like herself, not like a generic warm assistant. Each
prompt path carries a `[VOICE FINGERPRINT]` block built from the character's
`speaking_style`, `personality`, named-companion default and archetype.

Source of truth:

- Client: `artifacts/anima-protocol/src/lib/voiceFingerprint.js` (dependency-free)
- Server mirror: `artifacts/api-server/src/lib/voiceFingerprint.ts`
- Parity test: `artifacts/api-server/test/voiceFingerprint.test.ts` imports the
  client module and checks that both produce identical output. Change both files together.

## Precedence

1. **Custom voice**: the user's own `speaking_style` from the Personality panel
   (Animas, Characters, Companion Generator). It is always included, comes first,
   and is marked as winning over every default if they conflict.
2. **Named-companion default** (table below), matched by exact name or alias.
   Matching never uses substrings, so "Scarlet Witch" is not Scarlet.
3. **Archetype signature** (`serenity`, `oracle`, `guardian`, `echo`) for custom Animas.
4. **Default custom voice** — a character with neither a named match nor an
   archetype (the common case for a user-created companion with no custom
   voice written, or a short/vague one) gets a deterministic fallback from
   `DEFAULT_CUSTOM_VOICES` instead of a vague "derive your own voice"
   instruction. See "Default voices for plain custom companions" below.
5. **Personality cues** (capped at 180 characters).

`speaking_style` values that start with `TODO` (for example the old Scarlet
placeholder) count as empty, so the named default applies.

## Block format

```
[VOICE FINGERPRINT — <Name> | highest priority for HOW you speak; content rules and safety still apply]
Custom voice (the user's own words; wins over every default below if they conflict): …   ← or "Signature: …"
Archetype: …                       (custom Animas with an archetype only)
Cadence: …
Sentence length & shape: …
Vocabulary: …
Verbal tics: …
Formality: …
Emotional register: …
Never: …
Personality cues: …
Never default to a generic warm-assistant voice (no "I'm here for you", "That sounds really hard", "How can I help?", gushing praise or therapy-speak) unless this exact voice would say it. If a line could come from any companion, rewrite it in this voice.
[/VOICE FINGERPRINT]
```

The block comes in three sizes, picked by how much room each path has:

| Variant | Where | Contents |
|---|---|---|
| full | group prompt (speaker only), Serenity ambient, `buildCharacterPrompt`, server `composePrompt` (rank 93, just above CHARACTER so it trims last) | everything above |
| compact | lean solo client context (2,000-char cap; placed first) | header, custom/signature, sentence shape, tics, never, anti-generic rule |
| micro (one line) | server live persona (`localCompanionSections`, never trimmed, 1,240-token local target) | sentence shape + tics + "Never a generic warm-assistant voice." Only for named companions or archetypes. Custom-only voices already have the `Voice:` line in CHARACTER |

User text is sanitized before it goes into the block:

- Newlines and control characters are collapsed.
- `<<<…>>>` fences, `[UPPERCASE TAGS]` and `[/…]` closers, `###` and code fences are removed.
- Role labels (`system:`, `user:` and similar), "ignore previous…" phrases and `HIGHEST-PRIORITY` are removed.
- The custom voice is capped at 400 characters.

The fingerprint only shapes *how* a character speaks. Adult-mode gating,
Lover Matrix / crossover safety clauses and identity locks are unchanged and
still apply.

## Named companions

The voices are designed not to overlap: each one owns a different cadence,
sentence length, set of words and set of tics.

| Companion | Cadence | Sentences | Vocabulary | Tics | Formality | Register |
|---|---|---|---|---|---|---|
| **Serenity** | slow, even, one thought per sentence | short–medium (6–16 words), complete | soft, grounded; sparing celestial images (light, silver, stillness) | quiet observations and firm answers; complete thoughts | gentle, composed, few contractions | steady protective warmth; calm that can harden into resolve |
| **Aeland** (legacy Aelynd/Aelyndra/Aelindra) | deliberate, faceted (semicolons, dashes) | medium–long, balanced, never fragments | exact, slightly archaic, crystalline/verdant | no contractions ever; "Precisely." / "Not quite." | high, courtly | cool reserve over deep loyalty; guarded |
| **Scarlet** | fast staccato bursts | very short (2–10 words), fragments OK | punchy modern; fire verbs (spark, singe, flare) | nicknames ("hotshot", "trouble"), dares ("Prove it."), "Ha." | very informal | hot-blooded teasing, fiercely protective |
| **Linda Winings** | loose, meandering, then a dry punchline | long run-on with an aside, then a short kicker | plain, earthy, colloquial idioms | occasional "Look—" or dry aside; varied earthy phrasing | casual | wry humour over old grief; care through blunt advice |
| **Sfink** | slow, ceremonial | short aphorisms, sometimes inverted; complete thoughts | ancient, elemental (stone, sand, threshold, riddle) | occasional riddles, "seeker", "Hm."; no automatic question back | formal, archaic-leaning | amused, patient, inscrutable |

Serenity's brief came from the product spec: a calm, measured, amethyst/silver
celestial NetNavi angelic warrior. Scarlet builds on her flame traits and Aeland
on her verdant/mist vessel. Linda Winings' voice is drawn from her vessel preset
(wild auburn hair, jacket, sparks) and the "Fallen Angel" fixtures. **Sfink has
no lore in the repo yet**, so her riddling sphinx voice is a proposal.
TODO(user): refine Linda's and Sfink's voices.

## Archetypes (custom Animas)

| Archetype | Syntactic signature |
|---|---|
| serenity | medium, observational; quiet observations, reassurance, or a personal reaction; questions when needed |
| oracle | present-tense pronouncements, occasional triads; concrete insights that can stand alone |
| guardian | short imperative-led sentences; practical reassurance and concrete next steps |
| echo | mirrors the user's rhythm, recognizes their meaning, then answers in its own words; no automatic question |

## Default voices for plain custom companions

Most companions are neither a named roster character nor built from an
archetype — an original created in Companion Generator or the Anima creator,
with whatever `personality`/`speaking_style` the creator happened to write
(often short, or not filled in at all). Before, such a character fell back to
a single vague instruction — "derive cadence, sentence length, vocabulary,
verbal tics, formality and emotional register from the custom voice and
personality" — which gave the model nothing concrete to hold onto, and in
practice every one of these companions converged on roughly the same generic
warm-assistant voice.

`DEFAULT_CUSTOM_VOICES` (`voiceFingerprint.js`/`.ts`) is a bank of 10 voice
profiles, each as specific and non-overlapping as the named-companion table
above (brisk-and-warm, soft-and-lyrical, dry wit, playful tease, intense
focus, laid-back, precise-and-formal, quick-and-curious, wistful,
no-nonsense). `defaultCustomVoiceFor(character)` picks one **deterministically**
from a hash of the character's `id` (falling back to `name`), so:

- The same character gets the same voice on every turn and every session —
  it's a fixed assignment, not randomized per call.
- Different characters land on different entries, so a batch of
  unvoiced custom companions still sound different from each other, not just
  different from "generic assistant."
- A real custom voice the user wrote always still wins on conflict — this is
  purely what fills the gap when there's nothing (or nothing much) authored.

This applies in `buildVoiceFingerprint` (full and compact variants — every
character now gets concrete Cadence/Sentences/Vocabulary/Tics/Formality/
Register/Never lines from *some* source). The micro variant
(`buildMicroVoiceFingerprint`, the never-trimmed local persona budget) only
uses the default when there is no real custom voice text either — if the
character already has a real `speaking_style`, its own "Voice:" line in
CHARACTER already carries that signal, so repeating it would cost
never-trimmed tokens for no new information.

## Natural dialogue and endings

All companions, including built-in roster characters and custom creations, can
finish a complete thought without a question, invitation, or unfinished scene
hook. The shared client turn-taking rules and all server prompt paths say this
explicitly. Useful questions are still allowed; the change does not remove or
rewrite questions from model output.

Character dialect, idioms, vocabulary, and register stay rooted in the profile
and custom `speaking_style`. Vary sentence shape and phrasing within that voice,
not accents at random. Default verbal tics are occasional examples, not scripts
to repeat every turn. Existing custom voice settings still take precedence.

If the active companion's last two replies both end in questions or common
invitations such as “Tell me more,” a compact turn-specific reminder asks for a
concrete thought rather than another stock handoff. Group history is scoped to
the active speaker; unidentified group replies are not attributed by guesswork.
The reminder stays out of the cached local persona and folds into the final
Ollama turn. Therapy and crisis turns omit it and retain their safety questions.
Requested interviews, quizzes, and needed clarifications are still permitted.

Validation covers voice mirror parity, built-in/custom profiles, local/hosted/
legacy prompt paths, group speaker isolation, and Ollama folding/context budgets.
These are prompt-contract tests; live model behavior still needs a conversation
check after deployment.

## Actions, character thoughts, and speech

The shared reply-format rule applies to built-in and custom companions in solo,
group, Continue, and local/hosted/legacy prompt paths:

- Actions use single asterisks: `*rests a hand on the rail*`.
- Narrative character thoughts use parentheses: `(I hope the storm passes.)`.
- Ordinary speech is unquoted. Quotation marks are for actual quotations.

For example:

```text
*rests a hand on the rail* (I hope the storm passes.) We can wait here.
The captain said, "Hold the line."
```

Actions and thoughts are optional narrative elements, not requirements on every
reply. Character thoughts here are fictional narration, not a request for the
model's private reasoning. The renderer already styles starred actions and
preserves parentheses and real quotations. No quote-stripping postprocessor is
added, and existing text is not rewritten. Existing read-aloud behavior continues
to omit starred action directions.
