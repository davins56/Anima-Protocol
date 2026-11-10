# 3D Vessel

Customizable per-companion 3D body (R3F + drei + three, all pre-existing deps).

| Piece | Path |
| --- | --- |
| Typed config (zod, schema 1) + presets + photo serializer | `artifacts/anima-protocol/src/lib/vessel/vesselConfig.ts` |
| Emotion → expression weights (MOODS keys) | `src/lib/vessel/emotion.ts` |
| API client + cache | `src/lib/vessel/vesselApi.ts`, `src/hooks/useCharacterVessel.ts` |
| Procedural low-poly model + glTF/VRM asset slot | `src/components/vessel/VesselModel.tsx` |
| Performance host (adaptive DPR, PerformanceMonitor, offscreen pause, snapshot) | `src/components/vessel/VesselCanvas.tsx` |
| Inline chat-header portrait (lazy, dpr 1, ~12 fps demand loop) | `src/components/vessel/VesselPortrait.tsx` |
| Customization panel / full route `/vessel?character=` | `src/components/vessel/VesselCustomizer.tsx`, `src/pages/VesselStudio.tsx` |
| Typed customisation ("Type it" box) | `src/lib/vessel/vesselText.ts` — protocol: `docs/vessel-customisation-protocol.md` |
| Server whitelist sanitizer + store | `artifacts/api-server/src/lib/vessel/vesselStore.ts` |
| Routes `/api/vessel/:characterId[/snapshot]` | `artifacts/api-server/src/routes/vessel.ts` |
| Migration | `supabase/migrations/20261022170000_character_vessel.sql` |

**Save flow:** `PUT /api/vessel/:id` → `save_vessel_version()` → new immutable
`character_vessel` row → new `character_identity_core` version (`source='vessel'`,
`vessel_version`) → `vessel_changed` memory event. All in one transaction with an advisory lock.

**Serenity's forms:** her preset follows the canonical design bible (Serenity Vessel Spec).
The humanoid form (default) has long silver hair, violet eyes, warm golden-brown skin, and a black
gown with gold accents and a circlet standing in for her brow chain. The angelic form
(`SERENITY_ANGELIC`) has short white hair, silver-blue eyes, deeper brown skin, a white robe with a
blue accent, a halo ring and wings. Both keep `base: "serenity"`. When the base is Serenity, the
customizer shows a **Form** toggle; `serenityFormOf()` reports angelic only when the config has both
wings and a halo. Rows saved before this change keep their old colours until re-saved.

**Typed customisation:** the panel opens with a "Type it" box. `applyVesselText()` parses free text
into a `VesselConfig` patch — deterministic keyword/colour matching against the schema vocabulary,
no model call — and reports what it changed and which words it ignored. The typed description becomes
the save note, so `vessel_changed` memory records what was asked for. Protocol:
`docs/vessel-customisation-protocol.md`.

**Photo integration:** `InlinePhotoComposer` loads the saved vessel. When "Vessel vN" is on, it
appends `vesselToDescriptorPhrases()` to `extraDescriptor`. It also sends `useVesselReference`, so the
server signs the latest snapshot and uses it as a *secondary* reference; the locked identity refs
still win.

**Performance (iPad):**
- The chunk is only loaded on `/vessel` or when a vessel exists.
- The portrait uses dpr 1, no AA, the `demand` frameloop ticked at 12 fps, and no OrbitControls.
- The full view uses adaptive DPR 0.75–1.5 (2 with HD), drops to `never` when offscreen or the tab is hidden, and defaults to 8-segment flat-shaded geometry.
- Set `VITE_VESSEL_PORTRAIT=0` to disable the header portrait.

**Assets / licensing:**
- The procedural placeholder ships with zero third-party assets.
- `model.kind = gltf|vrm` + `model.url` loads a user-supplied glTF. VRM humanoid bones and expressions need `@pixiv/three-vrm` (MIT, not installed; TODO).
- Use only models with clear licenses: VRoid Studio exports (per the author's VRM license fields), or CC0 / commissioned work.
- Steward-uploaded VRM/GLB files (50 MB cap, signed direct-to-storage, schema 2 metadata): `docs/vessel-model-uploads.md`.
