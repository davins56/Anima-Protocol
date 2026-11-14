# Companion photos

A companion can send a photo when you ask for one ("send me a selfie", "show me",
"draw us", "picture this scene", "what does the beach look like there?") and,
sparingly, when a moment in the chat is vividly visual or emotional. The reply
streams as usual, a "sending a photo…" placeholder appears, and the picture
arrives on the same message with a short in-character caption. Tap it to view
it full size. Photos are high-resolution (FLUX.2 supports 256–1920 px per side).

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
   `[PHOTO: …]`, `[SELFIE: …]` or `[SCENE: …]` tag, that is a second, unprompted
   trigger (see **Spontaneous photos** below). The tag is always removed from
   the text, even when the photo is skipped.
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
   Unprompted photos that hit a limit or cooldown are skipped silently (no
   in-character decline), and still count toward the same hourly/daily caps
   when they are sent.
3. **Direct the reply.** One line is added to the prompt: either "you are
   sending a photo of …, write a short caption", or an in-character decline
   ("you keep your photos sweet here", "you'll send more tomorrow"). It never
   mentions rules, filters, models, or being an AI. When no photo is already
   planned and unprompted photos are allowed, a short extra line lets the
   companion emit one `[IMAGE: …]` tag on a vivid or emotional moment.
4. **Generate in parallel** (`scenePrompt.ts`, `imagePrompt.ts`, `workersAiImage.ts`).
   While the text streams, one background-model call (Llama 3.1 8B) reads the
   last 8–12 messages plus the identity core and produces a structured scene
   brief: scene, setting, who is present, mood, and orientation. If that call
   fails, a deterministic template is used instead. The final image prompt
   injects each person's canonical appearance **verbatim**, including an
   explicit skin-tone phrase and a guard against the model's known skin-tone
   lightening ("do not lighten, whiten, pale, or shift undertones"). The
   user's appearance is added only when memory facts already describe how
   they look; otherwise their face is kept unidentifiable. The companion's
   avatar is sent as a reference image so the face and style stay the same
   between photos. The seed is stable per companion and turn.
   - **Look**, in order: Customise Anima appearance prompts → card appearance
     fields → the built-in Animas (Serenity: white hair, warm golden-brown
     skin, crystalline angelic wings, halo; Aeland; Scarlet, each with
     "always visible" features) → look sentences mined from the backstory.
   - **Style**: pre-installed characters are always illustrated in their own
     art style, never photoreal. Custom companions use their Art Style, else
     match their avatar, else photoreal phone-camera.
   - **Size**: portrait 1024×1536, landscape 1536×1024, square 1024×1024, all
     within the FLUX.2 Klein 4B range of 256–1920 px. Overridden by
     `ANIMA_COMPANION_PHOTO_SIZE_*`.
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
| Cost per photo | ~200–280 neurons (est.) ≈ $0.002–0.003 | 1024×1536 output + one reference tile; schnell fallback is smaller |
| Intent + scene | two small 8B calls, only when a photo will be sent (intent only when the prefilter fires) | |
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
| `ANIMA_COMPANION_PHOTO_SIZE_SQUARE` | `1024x1024` | square output; each side clamped to 256–1920 |
| `ANIMA_COMPANION_PHOTO_SIZE_PORTRAIT` | `1024x1536` | people / selfies |
| `ANIMA_COMPANION_PHOTO_SIZE_LANDSCAPE` | `1536x1024` | places / wide scenes |
| `ANIMA_COMPANION_PHOTO_SPONTANEOUS` | on | `off` disables unprompted photos |
| `ANIMA_COMPANION_PHOTO_SPONTANEOUS_EXCHANGES` | 8 | minimum session turns after the last unprompted photo |
| `ANIMA_COMPANION_PHOTO_SPONTANEOUS_COOLDOWN_MIN` | 20 | minimum minutes after the last unprompted photo |

`GET /api/media/capabilities` returns `chat_photos: true` when photos are on
and the `AI` binding exists. The client then drops its own `[IMAGE:]`
instruction and image pipeline in solo chats.

## SSE contract

- `{"status":"photo","photo":{"state":"pending"}}`: generation started. The
  client keeps the streamed text and shows the placeholder.
- `done` adds `photo: {status: "sent" | "failed" | "declined", …}` and, when
  sent, `attachments: [{type:"image", url, source:"companion_photo", …}]`.
  On failure the in-character line is already in `content` / `visible`.

## Spontaneous photos

When photos are on, the chat mind may end a reply with `[IMAGE: …]` (or
`[PHOTO:]` / `[SELFIE:]` / `[SCENE:]`) if the moment is vividly visual or
emotional. The same safety gate and hourly/daily limits apply. Unprompted
photos are also limited to one per 8 session exchanges **and** 20 minutes
(both configurable). Hits on a limit or cooldown are skipped silently; the
tag is still stripped from the bubble. Set `ANIMA_COMPANION_PHOTO_SPONTANEOUS=off`
to disable the instruction and ignore tags.

## Known limits

- Avatars that are not a portrait of the character make poor references. The
  bundled `/seed-avatars/korra.jpg` is a meme grid of several characters, so
  Korra's photos drift; `/avatars/korra.jpg` works well.
- The image model still tends to lighten skin tone; prompts now inject the
  canonical complexion verbatim and a "do not lighten" guard, but results
  can drift.
- Generated high-res JPEGs are larger than the earlier 768×1024 shots
  (~0.8–1.5 MB). Anything over the upload cap fails with the in-character
  line.
- Photo URLs are unguessable UUIDs but not owner-checked, like avatars.
- When the user's appearance is not in memory facts, "draw us" keeps their
  face unidentifiable rather than inventing a likeness.

## Checks

```bash
cd artifacts/api-server
npx vitest run --config vitest.unit.config.ts test/companionPhotos.test.ts test/sceneImages.test.ts
cd ../anima-protocol
npx vitest run src/lib/chatImageGeneration.test.js src/lib/voicePrefs.test.js
```
