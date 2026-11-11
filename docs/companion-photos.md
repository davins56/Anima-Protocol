# Companion photos

A companion can send a photo when you ask for one ("send me a selfie", "show me
where you are", "what does the beach look like there?"). The reply streams as
usual, a "sending a photo…" placeholder appears, and the picture arrives on the
same message with a short in-character caption. Tap it to view it full size.

Solo chats only. Group scenes keep the older client-side `[IMAGE: …]` path.

Code: `artifacts/api-server/src/lib/companionPhotos/` (server) and
`Chat.jsx`, `useChatStreaming.js`, `MessageBubble.jsx`,
`chatImageGeneration.js` (`serverPhotoFromPayload`) on the client.

## How a turn works

1. **Detect** (`intent.ts`). A cheap regex prefilter (`mightWantPhoto`) skips
   almost every turn. On a hit, the background model
   (`ANIMA_WORKERS_AI_BACKGROUND_MODEL`, Llama 3.1 8B) reads the last few
   messages and returns JSON: is this really a photo request, of what
   (`self` / `scene` / `object`), framing, a concrete description the
   companion chooses from the conversation, explicitness, and minor /
   real-person flags. If that call fails, only an unmistakable ask ("send me a
   selfie") counts. If the companion writes its own `[IMAGE: …]`,
   `[PHOTO: …]` or `[SELFIE: …]` tag, that is a second trigger; the tag is
   removed from the text.
2. **Gate** (`safety.ts`, `turn.ts`). In order:
   - explicit content: always declined;
   - anything involving a minor is never sexualised: a request that mentions
     a minor is declined unless it is a wholesome scene without the companion,
     and a companion whose card says they are under 18 (age field,
     "15-year-old", "teenager", …) only ever sends wholesome photos;
   - real, identifiable people (celebrities, the user): declined;
   - suggestive (not explicit) photos only when the existing adult gate is on
     (age attestation + adult mode), not in therapy mode, and only for
     user-created adult companions. Pre-installed roster characters
     (`seed_*` / `is_starter`) never send suggestive photos;
   - per-user hourly and daily limits.
   Crisis turns, `continue` turns and group chats never plan a photo.
3. **Direct the reply.** One line is added to the prompt: either "you are
   sending a photo of …, write a short caption", or an in-character decline
   ("you keep your photos sweet here", "you'll send more tomorrow"). It never
   mentions rules, filters, models, or being an AI.
4. **Generate in parallel** (`imagePrompt.ts`, `workersAiImage.ts`). While the
   text streams, the server builds the image prompt: framing + the companion's
   look + the scene + a fixed style + a safety clause, and calls Workers AI
   through the existing `AI` binding. The companion's avatar is sent as a
   reference image so the face and style stay the same between photos. The
   seed is stable per companion and turn.
   - **Look**, in order: Customise Anima appearance prompts → card appearance
     fields → the built-in Animas (Serenity: white hair, crystalline angelic
     wings, halo; Aeland; Scarlet, each with "always visible" features) →
     look sentences mined from the backstory.
   - **Style**: pre-installed characters are always illustrated in their own
     art style, never photoreal. Custom companions use their Art Style, else
     match their avatar, else photoreal phone-camera.
5. **Attach.** The image is stored in Postgres (`uploaded_images`, same as
   avatars) and served from `/api/storage/objects/uploads/<uuid>`. `done`
   waits at most `ANIMA_COMPANION_PHOTO_TIMEOUT_MS` for it. The attachment
   (`source: "companion_photo"`, description, size, model) goes on the
   assistant message, the turn ledger and the server-persisted message, so it
   survives reloads and late clients.
6. **Remember.** A `memory_events` note ("I sent them a photo I took: …") is
   recalled as a moment, the turn memory says "(I sent a photo: …)", and
   recent history shows `[note: I sent a photo with this message: …]` so she
   knows what she sent. The persona guard strips that note if the model ever
   echoes it.

If generation fails, the reply gets one in-character line ("my camera's out of
juice for today", "that shot didn't come out right") instead of the photo.

## Model, cost, limits

| | Default | Notes |
| --- | --- | --- |
| Primary model | `@cf/black-forest-labs/flux-2-klein-4b` | 4 steps, multipart, reference image, output moderation |
| Fallback model | `@cf/black-forest-labs/flux-1-schnell` | text only, used on outages, never after a moderation flag |
| Cost per photo | ~105–130 neurons ≈ $0.0012–0.0014 | 768×1024 output + one reference tile; schnell ≈ 58 neurons |
| Intent check | ~1 small 8B call, only when the prefilter fires | |
| Latency | 4–9 s (live check, Nov 2026) | text streams meanwhile |

Workers AI is $0.011 per 1,000 neurons; the free tier is 10,000 neurons/day
(roughly 75–90 photos/day across all users, before chat). If a moderation flag
hits with the avatar attached, it retries once on the same model without the
avatar; a second flag is final. Quota errors are not retried.

Per-user limits are counted from `chat_turns.metadata.companion_photo.status =
'sent'` (no new table) plus in-flight photos. If that query fails, an
in-isolate counter applies.

## Configuration

All optional `vars` (listed in `CLOUDFLARE_RUNTIME_ENV_NAMES`). No new
secrets, bindings or migrations: it uses the existing `AI`, `ASSETS` (now
also handed to Express so bundled seed avatars can be used as references) and
Postgres.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANIMA_COMPANION_PHOTOS` | on | `off` / `false` / `0` disables photos (falls back to the old client path) |
| `ANIMA_COMPANION_PHOTO_MODEL` | `@cf/black-forest-labs/flux-2-klein-4b` | primary image model |
| `ANIMA_COMPANION_PHOTO_FALLBACK_MODEL` | `@cf/black-forest-labs/flux-1-schnell` | `off` disables the fallback |
| `ANIMA_COMPANION_PHOTO_DAILY_LIMIT` | 20 | photos per user per 24 h (0–500) |
| `ANIMA_COMPANION_PHOTO_HOURLY_LIMIT` | 6 | photos per user per hour (0–100) |
| `ANIMA_COMPANION_PHOTO_TIMEOUT_MS` | 45000 | how long `done` waits for the photo (5000–120000) |
| `ANIMA_COMPANION_PHOTO_REFERENCE` | on | `off` stops sending the avatar to Workers AI |

`GET /api/media/capabilities` returns `chat_photos: true` when photos are on
and the `AI` binding exists. The client then drops its own `[IMAGE:]`
instruction and image pipeline in solo chats.

## SSE contract

- `{"status":"photo","photo":{"state":"pending"}}`: generation started. The
  client keeps the streamed text and shows the placeholder.
- `done` adds `photo: {status: "sent" | "failed" | "declined", …}` and, when
  sent, `attachments: [{type:"image", url, source:"companion_photo", …}]`.
  On failure the in-character line is already in `content` / `visible`.

## Known limits

- Avatars that are not a portrait of the character make poor references. The
  bundled `/seed-avatars/korra.jpg` is a meme grid of several characters, so
  Korra's photos drift; `/avatars/korra.jpg` works well.
- Generated JPEGs are ~0.5–0.7 MB; anything over the 1 MB upload cap fails
  with the in-character line.
- Photo URLs are unguessable UUIDs but not owner-checked, like avatars.

## Checks

```bash
cd artifacts/api-server
npx vitest run --config vitest.unit.config.ts test/companionPhotos.test.ts
cd ../anima-protocol
npx vitest run src/lib/chatImageGeneration.test.js src/lib/voicePrefs.test.js
```
