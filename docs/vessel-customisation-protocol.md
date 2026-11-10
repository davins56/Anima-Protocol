# Vessel customisation protocol

How an Anima's 3D vessel is described, edited from words, versioned and saved. Applies to every
surface that renders that body: `/vessel` (Vessel Studio), the chat-header portrait, Sovereign
Presence, and the player panel in NetBattle.

The whole protocol rests on one rule: **one record, one renderer, one save path.** Nothing here
introduces a second 3D stack, a second schema, or a second store.

## 1. The record

`VesselConfig`, schema 2 — [`vesselConfig.ts`](../artifacts/anima-protocol/src/lib/vessel/vesselConfig.ts),
mirrored field-for-field by the whitelist sanitiser in
[`vesselStore.ts`](../artifacts/api-server/src/lib/vessel/vesselStore.ts).

| Field | Type | Allowed |
| --- | --- | --- |
| `schema` | literal | `2` (schema `1` is still accepted and upgraded) |
| `base` | enum | `serenity`, `linda`, `aeland`, `scarlet`, `custom` (legacy `aelindra`/`aelynd`/`aelyndra` read as `aeland`) |
| `bodyType` | enum | `slender`, `athletic`, `curvy`, `petite`, `tall` |
| `height` | number | `0.85`–`1.15` |
| `skinTone` | hex | `#rrggbb` |
| `hair.style` | enum | `long`, `bob`, `pixie`, `braid`, `ponytail`, `wild`, `bun` |
| `hair.color` | hex | `#rrggbb` |
| `eyes.color` | hex | `#rrggbb` |
| `eyes.glow` | number | `0`–`1` |
| `outfit.top` | string | free text, ≤ 40 chars (chips offer `robe`, `bodysuit`, `jacket`, `dress`, `armor`, `hoodie`) |
| `outfit.bottom` | string | free text, ≤ 40 chars (chips offer `skirt`, `trousers`, `shorts`, `gown`) |
| `outfit.color` / `outfit.accent` | hex | `#rrggbb` |
| `accessories` | string[] | ≤ 8, entries ≤ 30 chars (`circlet`, `earrings`, `choker`, `visor`, `scarf`, `halo-ring`, `shoulder-plates`) |
| `effects.aura` | enum | `none`, `halo`, `wings`, `sparks`, `mist`, `glitch`, `flame` |
| `effects.glow` | number | `0`–`1` |
| `effects.particles` | integer | `0`–`400` |
| `effects.color` | hex | `#rrggbb` |
| `model` | object | `kind` `procedural` \| `gltf` \| `vrm`; `url` is `/api/vessel/:id/model` or an allow-listed https `.vrm`/`.glb`; optional metadata (`format`, `path`, `bucket`, `byteSize`, `expressions`, `visemes`, `humanoid`, `animationCount`). Uploads: `docs/vessel-model-uploads.md` |

The record is descriptive data, never code. The renderer branches on it, not on the companion's
name, so a new preset is a row of numbers rather than a new component.

## 2. Invariants

1. **Schema is the contract.** The client parses every write with `parseVesselConfig`; the server
   re-sanitises the same shape. A field outside the table is dropped, not coerced.
2. **Versions are immutable.** Saving writes a new `character_vessel` row; triggers reject
   `UPDATE`, `DELETE` and `TRUNCATE`. Nothing rewrites history.
3. **A save is three rows.** `PUT /api/vessel/:characterId` → `save_vessel_version()` → new vessel
   version, new `character_identity_core` version (`source='vessel'`, `vessel_version`), and a
   `vessel_changed` memory event — one transaction, advisory-locked.
4. **No hidden renderer.** `VesselModel` (Studio, portrait) and `AnimaVesselMesh` (presence,
   battle) both consume the record through the shared emotion shift; neither owns private fields.
5. **Photos follow the vessel.** `vesselToDescriptorPhrases()` turns the record into identity
   phrases for the image prompt, so a typed change reaches generated images without extra wiring.

## 3. Typed customisation (text → record)

Implemented by `applyVesselText(text, current)` in
[`vesselText.ts`](../artifacts/anima-protocol/src/lib/vessel/vesselText.ts). It is deterministic:
keyword and colour matching against the vocabulary below, no model call, no network, no API key.

Pipeline:

1. **Normalise** — lowercase, hyphens/en-dashes to spaces, collapse whitespace.
2. **Clauses** — split on `, ; . ! ?` newline and the words `and`, `with`, `plus`.
3. **Colours** — match the palette longest-name-first, then apply a luminance modifier
   (`deep`/`dark`/`midnight`/`shadow` → darker, `pale`/`light`/`soft`/`bright` → lighter).
4. **Anchors** — find body/gear words per field: `hair`, `eyes`, `skin`, `outfit`, `accent`, `aura`.
5. **Bind** — each colour attaches to the nearest free anchor **in its own clause**. A colour with
   no anchor in its clause is dropped, never guessed at.
6. **Enums** — hair style, body type, aura, top, bottom, accessories. Later mentions win for
   single-value fields; accessories accumulate.
7. **Validate** — the patch is parsed through `VesselConfigSchema` before it leaves the function, so
   the caller can put the result straight on the save path.

Binding rules, in precedence order:

| Situation | Result |
| --- | --- |
| colour + field in the same clause | binds to the nearest free field |
| colour and field in different clauses | colour ignored |
| two fields, two colours, one clause (`white robe with an indigo sash`) | nearest wins each; `sash` maps to `outfit.accent` |
| field mentioned twice (`mist aura`, later `flame aura`) | the later one wins |
| ambiguous style word (`long`) not near a hair word | ignored, so `long robe` never changes hair |
| word outside the vocabulary | reported in `unmatched`, config untouched |

The function returns `{ config, applied, unmatched }`:

- `applied` — one line per changed field, e.g. `hair style: long → bob`, `accent: indigo`.
- `unmatched` — words that map to nothing, so the UI can say what it ignored instead of pretending.
- `current` is never mutated; an empty result leaves the config byte-identical.

The panel shows `applied` under the box, and the typed description becomes the save note, so the
`vessel_changed` memory event records what the steward asked for.

## 4. Worked example

Input:

> short white hair, silver-blue eyes, white robe with an indigo sash, small halo, violet wings, deep brown skin

Resolves to: hair `bob` `#f5f5f5`, eyes `#b9c6de`, outfit `robe` `#f5f5f5` accent `#4b3f9e`, aura
`wings` `#9670f0`, skin a darkened brown. `small halo` is superseded by the later `violet wings` —
one aura slot, last mention wins. Covered by
[`vesselText.test.ts`](../artifacts/anima-protocol/src/lib/vessel/vesselText.test.ts).

## 5. Extending the protocol

To allow a new word (not a new field):

1. Add it to the relevant list in `vesselText.ts` (`COLORS`, `*_SYN`, `FIELD_WORDS`).
2. If it maps to an enum, the enum must already exist in **both** `vesselConfig.ts` and the server
   `ENUMS` map in `vesselStore.ts`. Adding it to only one side makes saves silently fall back to
   the default.
3. Add a case to `vesselText.test.ts`.

To add a new field, treat it as a schema change: bump `schema`, extend the zod object, extend the
server sanitiser and its `ENUMS`, use it in the renderer, then update the table in §1.

## 6. Non-goals

- No second renderer, no VRM rigging change (that is a separate `@pixiv/three-vrm` task).
- No cosmetics shop or gacha: this protocol changes the body the companion already has.
- No LLM in the loop. If an LLM ever drafts a config it must emit this same record and pass the same
  validation; the store remains the authority.
