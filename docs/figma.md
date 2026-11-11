# Figma and code

**File:** [Anima Protocol – Design System & Screens](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82) (`VkJdHFwuUvVrNUiXwSgo82`). It's a private draft in *Dàvīn Smith's team* (Starter plan) and isn't shared or published.

Pages (the Starter plan allows at most 3): **Foundations** (`0:1`, cover frame `7:3`), **Components** (`1:4`), **Screens · iPad** (`1:5`).

## Tokens: single source of truth

`design/anima-tokens.json` drives both sides:

- **Figma variables** were created from this JSON:
  - `Primitives` has 25 variables (mode *Value*, no picker scopes).
  - `Anima · Semantic` has 17 variables (mode *Serenity Dark*). They're aliases to the primitives.
  - `Resonance` has 15 variables: colour, min and max for each band.
  - `Layout` has 12 variables: space and radius.
  - Every variable has WEB code syntax `var(--anima-...)`.
- **Code** is generated with `node scripts/design/sync-tokens.mjs`. It writes `artifacts/anima-protocol/src/styles/anima-tokens.css` (imported by `src/index.css`) and `anima-tokens.ts` (`RESONANCE_SPECTRUM`, `resonanceBandAt`, `spectrumColorAt`, `RESONANCE_GRADIENT_CSS`).
- **Drift check:** `node scripts/design/sync-tokens.mjs --check`.

Text styles: `Sacred/Display` and `Sacred/Title` (Cinzel), `UI/Heading`, `UI/Body` and `UI/Label` (Rajdhani), `Data/Mono` and `Data/Readout` (Share Tech Mono). These match `--font-sacred`, `--font-sans` and `--font-mono` in `src/index.css`.

Effect styles: `Glow/Amethyst`, `Glow/Silver`.

The existing cyan "Protocol" chrome in `src/index.css` is unchanged. It's exposed as `color/accent/protocol`. The Serenity amethyst/silver palette is added on top of it as `--anima-*`.

### Resonance spectrum (W axis)

| Band | Range | Colour | Glyph |
|---|---|---|---|
| Noise | 0-20 | #B91C1C | jagged glitch shard |
| Ambient | 20-45 | #F59E0B | soft diffuse ring |
| Data | 45-75 | #14B8A6 | hexagon lattice |
| Rare | 75-88 | #FACC15 | four-point star with halo |
| Serenity | 88-100 | #8B5CF6 | concentric rings with winged sigil |

The dial is one continuous control with no detents:

- Each band's colour is held at its band centre, and colours crossfade linearly between centres.
- On the Figma ring (an angular gradient) 0 is at 12 o'clock and values increase clockwise.

These visual bands are separate from the six functional `resonance_bands` rows (delta..omega) in the resonance migration, which still drive node placement and spawn rules. `FrequencyTuner` now uses the visual spectrum for its colour and label.

## Component to code mapping

Code Connect isn't available on this plan. `add_code_connect_map` returned: "You need a Dev or Full seat on an Organization or Enterprise plan to use Code Connect." The mapping is therefore kept in three places:

- the table below;
- `design/figma-code-map.json`;
- each Figma component's description (which names its source path).

| Figma component | Node | Properties | Code | Notes |
|---|---|---|---|---|
| Button | [`2:9`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=2-9) | Kind=Primary|Secondary|Ghost; Label (TEXT) | (no code component) | No shared Button component; Tailwind/shadcn classes inline (src/components/ui). |
| Chip | [`2:14`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=2-14) | Selected=false|true; Label (TEXT) | (no code component) | Inline preset/refine chips inside InlinePhotoComposer/VesselCustomizer. |
| MemoryHealth | [`2:24`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=2-24) | Status=Healthy|Recalled|Empty | `artifacts/anima-protocol/src/components/memory/MemoryHealth.tsx` | default export |
| VesselPortrait | [`2:37`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=2-37) | Mood=Calm|Joy|Hologram | `artifacts/anima-protocol/src/components/vessel/VesselPortrait.tsx` | props characterId, mood, intensity, fallback |
| ResonanceGlyph | [`2:69`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=2-69) | Band=Noise|Ambient|Data|Rare|Serenity | `artifacts/anima-protocol/src/components/resonance/ResonanceScene.tsx` | beacon visuals (shaders.ts); colours via styles/anima-tokens.ts |
| Icon/* | [`3:4`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=3-4) | 14 lucide icons (3:4…3:63) | `lucide-react` | Mic, Camera, Send, RefreshCw, RotateCw, Shirt, Smile, Lock, Box, X, Sparkles, Heart, Radio, Upload |
| IconButton | [`3:81`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=3-81) | Kind=Outline|Solid; Icon (INSTANCE_SWAP) | (no code component) | 44x44 touch target pattern; inline buttons in code. |
| PhotoAttachmentActions | [`3:82`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=3-82) | - | `artifacts/anima-protocol/src/components/photo/PhotoAttachmentActions.tsx` | props imageId, characterId |
| VoiceLauncher | [`3:144`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=3-144) | State=Idle|Live | `artifacts/anima-protocol/src/components/voice/VoiceLauncher.tsx` | Live mirrors useSerenityVoice status; panel = SerenityVoicePanel.tsx |
| MessageBubble | [`3:190`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=3-190) | Role=Companion|User|Photo | `artifacts/anima-protocol/src/components/chat/MessageBubble.jsx` | Role=Photo = image attachment + PhotoAttachmentActions |
| ChatHeader | [`4:66`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=4-66) | - | `artifacts/anima-protocol/src/components/chat/ChatHeader.jsx` | contains VesselPortrait + MemoryHealth |
| InlinePhotoComposer | [`4:100`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=4-100) | - | `artifacts/anima-protocol/src/components/photo/InlinePhotoComposer.tsx` | InlinePhotoComposerProps |
| ChatInput | [`4:148`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=4-148) | - | `artifacts/anima-protocol/src/components/chat/ChatInput.jsx` | VoiceLauncher mounted beside it in pages/Chat.jsx |
| FrequencyTuner | [`5:177`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=5-177) | Tuned=Serenity|Crossfade | `artifacts/anima-protocol/src/components/resonance/FrequencyTuner.tsx` | value, onChange, lockStrength, lockedLabel |
| ResonanceNode | [`5:223`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=5-223) | Band=Noise..Serenity | `artifacts/anima-protocol/src/components/resonance/ResonanceScene.tsx` | Beacons (instanced) + lib/resonance/openNode.ts |
| ResonanceScene | [`5:224`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=5-224) | - | `artifacts/anima-protocol/src/components/resonance/ResonanceScene.tsx` | static stand-in for R3F scene |
| VesselCanvas | [`5:323`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=5-323) | - | `artifacts/anima-protocol/src/components/vessel/VesselCanvas.tsx` | viewport placeholder; model VesselModel.tsx |
| VesselCustomizer | [`5:333`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=5-333) | - | `artifacts/anima-protocol/src/components/vessel/VesselCustomizer.tsx` | value: VesselConfig, onChange |
| IdentityLockPanel | [`5:433`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=5-433) | - | `artifacts/anima-protocol/src/components/photo/IdentityLockPanel.tsx` | reference images + VisualDescriptor FIELDS + lock |
| PhotoGallery | [`5:475`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=5-475) | - | (no code component) | design-ahead; proposed src/components/photo/PhotoGallery.tsx (GET /api/photo/images) |

## Screens (iPad Pro 13", 1376x1032 pt)

| Frame | Node | Route | Code |
|---|---|---|---|
| Chat · iPad Pro 13 landscape | [`6:2`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=6-2) | `/chat/:id` | `artifacts/anima-protocol/src/pages/Chat.jsx` |
| Chat · iPad Pro 13 portrait | [`6:249`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=6-249) | `/chat/:id` | `artifacts/anima-protocol/src/pages/Chat.jsx` |
| Resonance · iPad Pro 13 landscape | [`6:361`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=6-361) | `/resonance` | `artifacts/anima-protocol/src/pages/Resonance.tsx` |
| Vessel Studio · iPad Pro 13 landscape | [`6:582`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=6-582) | `/vessel` | `artifacts/anima-protocol/src/pages/VesselStudio.tsx` |
| Photo Generator · iPad Pro 13 landscape | [`6:726`](https://www.figma.com/design/VkJdHFwuUvVrNUiXwSgo82/Anima-Protocol?node-id=6-726) | `/chat/:id (photo studio)` | `artifacts/anima-protocol/src/components/photo/InlinePhotoComposer.tsx + IdentityLockPanel.tsx` |

PNG exports are in `/workspace/figma-exports/` on the dev box. They aren't committed.

## Limitations

- **Starter plan, View seat:**
  - at most 3 pages;
  - MCP read tools are capped at about 20 calls/month (write tools are exempt);
  - no Code Connect, and no library publishing (intentionally not done anyway).
- **Images:** photos and reference images are gradient placeholders. The Plugin API can't fetch external images.
- **3D views:** the vessel viewport and the scan map are static vector stand-ins for the R3F canvases.
- **Bound fills ignore opacity:** fills bound to variables ignore paint opacity on some vessel-silhouette layers, so they render solid.
- **No Figma frames yet** for `VoiceIdentityPanel.tsx` or `SerenityVoicePanel.tsx`.

## Companion roster (Aeland + Scarlet)

- Canonical name of the third companion is **Aeland**; Figma's "Chip · Aelindra" (Components 5:339, instanced in Vessel Studio 6:600) must read "Aeland".
- **Scarlet** (built-in, flame vessel) gets a "Chip · Scarlet" and Primitives `scarlet/200 #FECACA`, `scarlet/400 #FDE047`, `scarlet/500 #F97316`, `scarlet/900 #7F1D1D` (already in `design/anima-tokens.json` → `--anima-scarlet-*`).
- **Status:** NOT yet applied in Figma — the Figma MCP Starter-plan tool-call limit was reached. The exact Plugin-API script is `scripts/design/figma-companion-roster.js`; run it through `use_figma` once the quota resets or the plan is upgraded.
