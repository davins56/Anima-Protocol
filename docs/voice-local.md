# Self-hosted voice: `anima-voice/1`

Her voice runs on **your home box**: Kokoro-82M (Kokoro-FastAPI, GPU) speaks and
faster-whisper (speaches, CPU) listens. When the box is down the app shows
**voice offline**. **Nothing falls back to a cloud voice on its own.**
ElevenLabs, xAI Grok Voice, browser Web Speech and iOS native speech remain
available only as **off-by-default opt-ins** (see §8).

Agreed with Anima Protocol Builder (voice UI) and Anima 3D Visual (lip-sync).
Server: `artifacts/api-server/src/routes/voiceLocal.ts`. Shared shapes:
`src/lib/voice/localContract.ts`. Mapper: `src/lib/voice/visemes.ts`.
Home-box client: `src/lib/voice/localVoiceClient.ts`. Slot: `src/lib/voice/voiceSlot.ts`.

```
iPad (Clerk session)
  └─ /api/voice/…  Cloudflare Worker (Express)        ← owner check, slot, timeline
       └─ ANIMA_LOCAL_VOICE_BASE_URL (bearer, tunnel)
            └─ openai-proxy.py on the home box
                 ├─ /tts/*  → Kokoro-FastAPI :8880 (GPU)
                 └─ /stt/*  → speaches        :8000 (CPU, faster-whisper)
```

## 1. Auth (every route)
- Clerk session required → `401` otherwise.
- The character must belong to the caller (`user_entities` `Character`/`Anima`
  row for that user). A companion you don't own is a **404, byte-identical to a
  missing one**. The box is never called for it.
- Her voice is read only from **your** companion record (`kokoro_voice_id`).
- The browser never talks to the box; the Worker holds the box bearer.

## 2. Timeline (one clock for everything)
- Audio is **PCM16 little-endian, mono, 24 kHz** (Kokoro's native rate).
- Every `offsetMs`, `startMs`, `endMs` and `sampleOffset` is **cumulative from the
  start of the utterance**, across all sentence requests that share an
  `utteranceId`. `sampleOffset = round(offsetMs × 24)` (24 kHz samples), so the
  client can map any event straight onto its AudioContext schedule.
- **Who tracks the sentence offset: the client.** A reply is spoken as one
  `/speak` request per sentence. The client sends `sentenceIndex` and
  `sentenceOffsetMs` = the previous sentence's `done.totalMs` (0 for the first).
  The server does not track this itself because consecutive requests can land
  on different Worker isolates.
- There is **no amplitude field**. Mouth shape comes from viseme cues; 3D Visual
  may still read the live output level locally if it wants.

## 3. `GET /api/voice/local/status`
```json
{ "contract": "anima-voice/1", "state": "online",
  "tts": { "engine": "kokoro", "sampleRate": 24000, "formats": ["pcm16"], "visemes": true, "ok": true },
  "stt": { "engine": "faster-whisper", "sampleRate": 16000, "partials": false, "maxSeconds": 60, "ok": true },
  "cloudFallback": false }
```
`state`: `online | offline | disabled | busy`. When not online a `reason` is present:

| reason | meaning |
|---|---|
| `box_unreachable` | tunnel/box/Kokoro didn't answer (network error, timeout, 502/504) |
| `model_loading` | Kokoro answered 503 or reported a loading status |
| `disabled_by_user` | the owner switched local voice off (`ANIMA_LOCAL_VOICE=off`) or no box URL is set |
| `busy` | a voice stream is playing right now (this isolate) |

Probes `/tts/health` and `/stt/health` with a 2.5 s timeout; cached 10 s
(`?fresh=1` skips the cache). `GET /api/voice/local/voices` → `{ "voices": ["af_heart", …] }`
lists Kokoro's built-in voices for the picker.

## 4. Fail-closed 503
Every local voice route answers like this when it can't use the box:
```json
HTTP 503
{ "error": "Her voice is offline — your home voice server isn't reachable.",
  "code": "voice_offline", "reason": "box_unreachable", "retryable": true, "cloudFallback": false }
```
`code`: `voice_offline` (`box_unreachable` / `model_loading`), `voice_disabled`
(`disabled_by_user`), `voice_busy` (`busy`). The same `reason` values as status.
The server never calls ElevenLabs/xAI/Web Speech instead. The client shows text
only plus a "voice offline" state.

## 5. `POST /api/voice/:characterId/speak` → `text/event-stream`
Request:
```json
{ "utteranceId": "u_7f3a", "sentenceIndex": 1, "sentenceOffsetMs": 1840,
  "text": "I missed you today." }
```
`utteranceId` `[A-Za-z0-9_-]{1,64}`; `text` ≤ 1000 chars after cleanup (tags,
stage directions and links are not spoken). Status is checked first, so a down
box is a JSON 503 (§4), not a stream.

Events, in order:
```
event: meta            ← always first, before the slot or any audio
data: {"contract":"anima-voice/1","streamId":"vs_<tag>_<id>","utteranceId":"u_7f3a",
       "sentenceIndex":1,"sentenceOffsetMs":1840,"offsetMs":1840,"sampleOffset":44160,
       "sampleRate":24000,"format":"pcm16","channels":1,"voice":{"id":"af_heart","engine":"kokoro"}}

event: visemes         ← covers the next audio window; always sent before that audio
data: {"seq":0,"offsetMs":1840,"sampleOffset":44160,"cues":[
  {"viseme":"sil","startMs":1840,"endMs":1890},
  {"viseme":"aa","startMs":1890,"endMs":1990},
  {"viseme":"ih","startMs":1990,"endMs":2040,"weight":0.3},
  {"viseme":"sil","startMs":2280,"endMs":2440}]}

event: word            ← one per word, also before its audio
data: {"seq":0,"word":"I","startMs":1890,"endMs":1990,"offsetMs":1890,"sampleOffset":45360}

event: audio           ← ~250 ms frames
data: {"seq":0,"offsetMs":1840,"sampleOffset":44160,"samples":6000,"durationMs":250,"pcm":"<base64 s16le>"}

event: done
data: {"streamId":"vs_…","utteranceId":"u_7f3a","sentenceIndex":1,"reason":"completed",
       "durationMs":1210,"totalMs":3050}
```
- `done.totalMs` = cumulative utterance length so far = next sentence's `sentenceOffsetMs`.
- `done.reason`: `completed | stopped | error`.
- Mid-stream failure: `event: error` `{code, reason, retryable, cloudFallback:false, error}` then `done` with `reason:"error"`.
  A full voice slot shows up here as `voice_busy` / `busy` (after `meta`).

**Ordering guarantee.** Kokoro returns word timestamps together with each audio
chunk (one chunk per sentence in the common case: Kokoro-FastAPI chunks at
~175–250 tokens). The server buffers each chunk and sends its `visemes` and
`word` events **before** the chunk's first `audio` frame, so a window's cues are
never later than its audio. Tested.

### Visemes
`viseme ∈ aa | ih | ou | ee | oh | sil`. `weight` is optional (0–1) and **defaults to 1**;
it is omitted on `sil` and on full-weight cues. Cues are sorted, integer ms,
non-overlapping, `startMs < endMs`, monotonic across sentences.
- `sil` for word gaps **> 80 ms** and from the last word to the end of each
  audio window (so every sentence ends with the mouth closed).
- Kokoro-FastAPI documents **word**-level timestamps, not phoneme-level, so each
  word's phonemes are spread across the word (vowels weigh 2×). IPA comes from
  Kokoro's own G2P (`/dev/phonemize`, misaki); when it can't be aligned word for
  word the spelling is used instead. This is an approximation.

| IPA (misaki capitals are diphthongs) | viseme | weight |
|---|---|---|
| a ɑ I(aɪ) W(aʊ) | aa | 1 |
| æ ʌ ɐ ə ᵊ | aa | 0.9 / 0.8 / 0.7 / 0.5 / 0.4 |
| i ɪ ɨ | ih | 0.9 / 0.8 / 0.7 |
| e ɛ A(eɪ) / ɜ ɚ | ee | 0.9–1 / 0.7 / 0.6 |
| u ʊ ɯ | ou | 1 / 0.8 / 0.7 |
| o ɔ O(oʊ) Q(əʊ) Y(ɔɪ) / ɒ | oh | 1 / 0.9 |
| p b m (closed lips) | sil | — |
| w / ɹ r | ou | 0.6 / 0.4 |
| j | ih | 0.4 |
| f v | ih | 0.25 |
| other consonants (t d n l s z θ ð ʃ ʒ ʤ ʧ k ɡ ŋ h …) | ih | 0.3 |

Adjacent cues with the same viseme are merged. A model that lacks a viseme drops
that cue (3D Visual's existing `availableVisemes`).

## 6. Barge-in: `POST /api/voice/:characterId/speak/:streamId/stop`
```json
{ "utteranceId": "u_7f3a", "heardMs": 2210, "reason": "barge_in" }
```
- `heardMs` is on the same cumulative timeline (what actually played).
- `reason`: `barge_in | user_stop | navigation`.
- The stream gets an **immediate** `event: stopped` `{"heardMs":2210,"offsetMs":2210,"sampleOffset":53040}`
  followed by `done` `{reason:"stopped", totalMs}`. Builder uses it; 3D Visual closes
  the mouth locally anyway.
- Response:
```json
{ "event": "final", "streamId": "vs_…", "utteranceId": "u_7f3a", "reason": "stopped",
  "stopReason": "barge_in", "heardMs": 2210, "heardText": "Hey you. I missed",
  "heardTextSource": "server", "cancelled": { "tts": true } }
```
- `heardText`: the utterance's words (all sentences this isolate spoke for that
  `utteranceId`) whose midpoint is ≤ `heardMs`, so the transcript can truncate to
  what was heard. If the stop lands on a different Worker isolate the server
  doesn't have the timings: `heardText:null`, `heardTextSource:"unavailable"`,
  and the client aligns from the `word` events it received.
- Cancellation: the server aborts the Kokoro request (the home-box proxy closes
  the upstream connection when its client goes away). Across isolates the stop
  releases the stream's **voice slot**; the streaming isolate sees its heartbeat
  fail within ~1 s and stops. Aborting the SSE fetch also stops it.
- The client still owns: flushing local playback, aborting the chat stream if the
  reply is still generating, and saving the interrupted turn
  (`POST /api/voice/:id/turns` with `interrupted:true` and the heard text).
- Stream ids embed a per-user tag; another user's id is a 404.

**Builder UI event:** `voice:stop` → flush playback → POST stop → abort fetch → `idle`.

## 7. Push-to-talk STT: `POST /api/voice/:characterId/transcribe`
v1 is push-to-talk only (no VAD, no partials, no WebSocket). The iPad records,
resamples to 16 kHz mono (existing `micCapture.ts`) and sends one of:
- `Content-Type: audio/pcm;rate=16000` with raw **s16le** mono (not `audio/L16`, which is big-endian by RFC);
- `Content-Type: audio/wav`, PCM16 mono 16 kHz;
- JSON `{ "audioBase64": "…", "contentType": "audio/pcm;rate=16000" }`.

Caps: **60 s** (`413 voice_audio_too_long`), 2 MB body (`413 voice_audio_too_large`),
wrong rate/channels/odd bytes/empty (`400 voice_audio_invalid`).
```json
{ "final": true, "text": "I had a rough day", "language": "en", "durationMs": 1480,
  "words": [{ "w": "I", "startMs": 120, "endMs": 220 }] }
```
Audio is never stored and goes nowhere but your box. Box or STT server down → §4 503.

## 8. Cloud voices: opt-in only
| Path | Before | Now |
|---|---|---|
| Voice notes `POST /api/media/voice-clip` | xAI if `XAI_API_KEY`, else ElevenLabs, automatically | Home box first. xAI/ElevenLabs only when the request carries `cloud_opt_in` (the user's setting) and the key exists. Otherwise 503 `voice_offline`, `cloudFallback:false` |
| Chat auto-speak (`Chat.jsx`) | iOS native speech **always first** inside the app, then ElevenLabs / Web Speech when toggled | Each engine needs its opt-in setting (all **off by default**): `nativeSpeech`, `elevenlabs`, `webSpeech`. The toolbar toggles still apply on top |
| Grok Voice realtime | `ANIMA_VOICE_AGENT=xai` server opt-in | unchanged (already opt-in) |

Settings live per device in `localStorage["anima.voice.cloudOptIn.v1"]`
(`artifacts/anima-protocol/src/lib/voicePrefs.js`), so the iPad can opt into
iOS native speech as its backup without changing other devices. The Settings
screen toggles are Builder's (V6); until they ship, `setCloudVoiceOptIn()` is
the API.

## 9. Per-companion voice
Stored as `kokoro_voice_id` on the companion's own record (`user_entities.data`,
same place as `elevenlabs_voice_id`), written by the normal companion update.
Valid ids look like `af_heart` (`^[a-z]{2}_[a-z0-9]{2,24}$`, no blends). Missing
or invalid → `ANIMA_LOCAL_VOICE_DEFAULT` → `af_heart`. No migration is needed.
The versioned `character_voice` table (identity-core history, memory event on
change) only allows `provider='xai'`. Moving Kokoro voices into it is optional
and needs a migration that has **not** been written into `supabase/migrations`
or applied; the proposed SQL is in §12.

## 10. Server configuration
| Var | Where | Notes |
|---|---|---|
| `ANIMA_LOCAL_VOICE_BASE_URL` | Secrets Store (create the secret **before** adding a binding) | e.g. `https://llm.anima-protocol.com` (the proxy serves `/tts/*` and `/stt/*`) |
| `ANIMA_LOCAL_VOICE_API_KEY` | Secrets Store | Optional; defaults to `ANIMA_LOCAL_LLM_API_KEY` (same proxy token) |
| `ANIMA_LOCAL_VOICE` | var | `off` → `disabled_by_user` |
| `ANIMA_LOCAL_VOICE_DEFAULT` | var | Default Kokoro voice (`af_heart`) |
| `ANIMA_LOCAL_STT_MODEL` | var | speaches model id (default `Systran/faster-distil-whisper-small.en`) |

The voice slot reuses the `LOCAL_LLM_SLOT` Durable Object class under the object
name `"voice"`: an independent book from the LLM's `"ollama"` slot, one stream
at a time, FIFO, 6 s wait, no new DO migration.

## 11. Home box
See `scripts/llm/public-v1/README.md` §Voice:
```bash
docker run -d --gpus all -p 127.0.0.1:8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
docker run -d -p 127.0.0.1:8000:8000 -v hf-hub-cache:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:latest-cpu
SPEACHES_BASE_URL=http://127.0.0.1:8000 uvx speaches-cli model download Systran/faster-distil-whisper-small.en
ANIMA_VOICE_TTS_UPSTREAM=127.0.0.1:8880 ANIMA_VOICE_STT_UPSTREAM=127.0.0.1:8000 \
  bash scripts/llm/public-v1/start-public-v1.sh
```
If chat moves to vLLM on the same GPU, cap `--gpu-memory-utilization` (vLLM
defaults to 0.92–1.0) and check headroom with `nvidia-smi`.

Unverified until run on the box: Kokoro-FastAPI's `/health` body, speaches'
`/health` route, and whether Kokoro stops generating the moment its HTTP
client disconnects (the proxy does close the upstream socket).

## 12. Optional migration (NOT applied, NOT in `supabase/migrations`)
Only if Kokoro voices should get versioned identity history like xAI voices.
`save_voice_version()` also hard-codes `'provider','xai'` in the identity JSON
and has no provider parameter, so it would need a follow-up change too.
```sql
-- Proposed: allow self-hosted Kokoro voices in the versioned voice table.
ALTER TABLE public.character_voice
  DROP CONSTRAINT IF EXISTS character_voice_provider_check;
ALTER TABLE public.character_voice
  ADD CONSTRAINT character_voice_provider_check
  CHECK (provider IN ('xai', 'local'));
```
