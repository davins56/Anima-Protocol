# Lean group prompt + shareable companion cards

## (18) Server-built lean per-character group prompt

`ANIMA_LEAN_GROUP_PROMPT=1` (default off, mirrored on the Worker):

- For a group turn with a resolved speaker, `promptBuilder` drops the
  client's `buildGroupPrompt` text. The server already builds everything
  the turn needs:
  - the speaker's persona and accepted identity, and only that speaker's
    memories;
  - crossover awareness of the other characters;
  - store history;
  - the server mode contract;
  - `TURN RULES` and `OUTPUT FORMAT` for that speaker.
- Solo turns and group turns without a speaker are unchanged.

Remaining:

- The client still builds and sends its fat group prompt. With the flag on,
  the server just ignores it. Stopping the client from building it needs a
  Chat.jsx change.
- Scenario and lore lines that only exist in the client prompt are lost
  under the flag. Move them to a structured scene field first.

## (14) Identity-only shareable companion cards

- `lib/companions/shareCard.js` builds the card from a whitelist: canonical
  name ("Aeland"), archetype, universe, a one-sentence tagline, and the
  vessel's aura, eye and accent colours.
- The card never includes memories, backstory, chat, intimacy settings,
  user data or private image URLs. The tests check this.
- `shareCardSvg` produces a self-contained SVG. All text is XML-escaped, and
  there are no scripts or external references.
- `ShareCompanionCard.jsx` offers Copy, Download (SVG) and the device share
  sheet. All are local, user-initiated actions; nothing is uploaded or
  published.
- The card page is `/companions/:characterId/card`.

Remaining: there is no entry button on the companion list yet (link to the
route), and no PNG export.

## (12) Resonance / Echo Keys minting

Not done. Echo Keys are discovered, synthesised or evolved client-side in
`lib/echoKeys`. Server-side minting would need:

- a server-owned, append-only key ledger, like the entitlement ledger;
- the steward-grant middleware from feature/safety-gates applied to
  profile writes, which is already done;
- a decision on whether minted keys are tradeable, which affects abuse and
  economy.
