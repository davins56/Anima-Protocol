# Lifelike photo generator (identity-locked companion photos)

## Where it lives
| Layer | Path |
|---|---|
| SQL migration | `supabase/migrations/20261022150000_photo_generator.sql` |
| API route (Express → Cloudflare Worker) | `artifacts/api-server/src/routes/photo.ts` (mounted in `routes/index.ts`) |
| Orchestration | `artifacts/api-server/src/lib/photo/generatePhoto.ts` |
| Provider (fal.ai queue, no SDK) | `lib/photo/falClient.ts`, `lib/photo/providerRouter.ts` |
| Prompt composer (identity anchor + scene) | `lib/photo/promptComposer.ts` |
| Storage (Supabase Storage → fallback `uploaded_images`) | `lib/photo/photoStorage.ts` |
| DB access | `lib/photo/photoStore.ts` |
| Client API / SSE | `artifacts/anima-protocol/src/lib/photo/photoApi.ts` |
| Hook | `src/hooks/usePhotoGeneration.ts` |
| UI | `src/components/photo/InlinePhotoComposer.tsx`, `IdentityLockPanel.tsx`, `PhotoAttachmentActions.tsx` |
| Chat wiring | `src/pages/Chat.jsx` (lazy composer above `ChatInput`), `src/components/chat/MessageBubble.jsx` (refine row) |

The repo has no Supabase Edge Functions: the server runs as the Express api-server
bundled into the Cloudflare Worker (`wrangler.jsonc` → `artifacts/api-server/src/worker.ts`).
Generation runs there and streams SSE, exactly like `/api/chat`.

## Identity lock
Each (user, character) has one `character_visual_identity` row: reference photos
(one primary face), an immutable descriptor (skin tone, eyes, hair, build, marks),
negative traits and `provider_config`. Locking freezes references/traits; every change bumps `version`
and each `generated_images` row records the `identity_version` it used.

Strategy per request (`providerRouter.pickStrategy`):
1. **kontext** (`fal-ai/flux-pro/kontext`): outfit / expression / angle refinement edits the parent image.
2. **lora** (`fal-ai/flux-lora`): when `provider_config.lora_url` is set (train with
   `fal-ai/flux-lora-fast-training` on 10–20 refs). This gives the strongest identity lock.
3. **pulid** (`fal-ai/flux-pulid`): zero-shot face identity from the primary reference (default).
4. **gemini**: fallback with the existing `geminiImage.ts` edit path when `FAL_KEY` is unset.

## Streaming
`POST /api/photo/generate` → SSE `accepted → status* → image → done` (or `error`), relayed from
fal's `/status/stream`. The client uses the existing `readSseJsonStream`.

## Secrets (server only)
`FAL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `SUPABASE_PHOTO_BUCKET`, `FAL_*_MODEL`.
On Cloudflare, add them to the Secrets Store and declare them in `wrangler.jsonc` `secrets_store_secrets`
**after** creating the store entries (a binding to a missing secret fails deploy).

## drizzle-kit safety
`lib/db/protected-tables.ts` + `tablesFilter` in `lib/db/drizzle.config.ts` stop `drizzle-kit push --force`
from dropping SQL-migration tables that are not in the Drizzle schema.
