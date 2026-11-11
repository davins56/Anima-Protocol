# Serenity Voice (xAI Grok Voice realtime)

Full-duplex, interruptible voice calls with a companion. The xAI API key stays in the Worker. The browser only ever holds a short-lived client secret.

## API verification (docs.x.ai, checked 2026-10-22)

| Capability | Status | Source |
| --- | --- | --- |
| WS `wss://api.x.ai/v1/realtime?model=…` | ✅ verified | Speech to Speech, API reference › Realtime |
| Models `grok-voice-latest` (alias of `grok-voice-3.0`), `grok-voice-3.0`; 2.0 deprecated | ✅ verified | Speech to Speech › Model Selection |
| Price $0.08/min (+$0.004 per text input) | ✅ verified | Pricing › Voice API |
| Server VAD `turn_detection: {type:"server_vad"}`, `speech_started/stopped` | ✅ verified | API reference |
| Barge-in: in VAD mode the server handles interruption; client flushes playback and sends `conversation.item.truncate {item_id, content_index:0, audio_end_ms}` | ✅ verified (`response.cancel` documented for non-VAD/manual only) | API reference › Client Messages |
| Ephemeral token `POST /v1/realtime/client_secrets {expires_after:{seconds}}` → `{value, expires_at}`, max 3600 s; browser subprotocol `xai-client-secret.<token>` | ✅ verified | Ephemeral Tokens, API reference |
| Binding `session` to a client secret | ⚠️ contradictory: the API reference lists it, the guide says "Does not support `session`" | not used; the server returns the `session.update` payload separately |
| PCM16 24 kHz default; `audio.input/output.format`, `transport: json|binary`, `output.speed` 0.7–1.5 | ✅ verified | Speech to Speech › Session Parameters |
| Function tools (`response.function_call_arguments.done` → `function_call_output` → `response.create` after playback) | ✅ verified | Speech to Speech › Using Tools |
| Session resumption (`resumption.enabled` + `?conversation_id=`; 30 min TTL) | ✅ verified | Speech to Speech › Session Resumption |
| `force_message` scripted TTS turns | ✅ verified (xAI extension) | Speech to Speech › Force Message |
| Voice roster | ✅ `GET /v1/tts/voices`. The documented sample lists **26** voices, not 28, so the roster is fetched dynamically and never hard-coded. | API reference › TTS voices |
| Voice cloning `POST /v1/custom-voices` (multipart `file` last, ≤120 s, 30 voices/team, 8-char `voice_id`) | ✅ verified, **but the API is Enterprise-gated** (403 otherwise) and Custom Voices is US-only (excl. Illinois). Console cloning is free (≤30). | Custom Voices guide |
| Regional endpoint for lower latency | ❌ `us.api.x.ai` **does not serve voice APIs** | Regional Endpoints |
| WebRTC transport | Mentioned (demo app) but not specified in the reference | `VoiceTransport` adapter, `TODO(voice-webrtc)` |

Nothing undocumented is called. The transport refuses any URL other than `wss://api.x.ai/v1/realtime`.

## Flow
1. `POST /api/voice/:characterId/session` (Clerk-authenticated, 12/min) does three things:
   - mints a 300 s client secret (`ANIMA_VOICE_TOKEN_TTL_S`);
   - builds the documented `session.update` payload: voice, persona and memory-core instructions, server VAD, PCM 24 kHz, and four function tools;
   - returns `{token, expires_at, url, session}`.
2. `useSerenityVoice` (`src/hooks/useSerenityVoice.ts`) sets up the call:
   - creates the AudioContext in the tap gesture;
   - loads the AudioWorklets (`src/lib/voice/worklets.ts`);
   - starts the mic **and** the socket in parallel, buffering early mic audio;
   - sends `session.update` with `resumption.enabled`.
3. Playback is streamed (`StreamPlayer`). The worklet counts played frames, so `audio_end_ms` on truncate reflects what the user actually heard.
4. Tools are wired to the other modules (`src/lib/voice/tools.ts`). Outputs are sent, the client waits for playback to drain, then sends `response.create`.

   | Tool | Wired to |
   | --- | --- |
   | `recall_memories` | memory-core bootstrap with query |
   | `open_resonance_node` | `/resonance?tune=&band=&signal=` |
   | `generate_photo` | photo SSE with the vessel reference; the result is shared into the chat thread |
   | `show_vessel_view` | `/vessel?character=` |
5. On `response.done`, `POST /api/voice/:id/turns` writes a `turn` memory event: `source='voice'`, dedupe `voice:<conversation>:<response>`, including the interrupted flag and latency.
6. Reconnect uses exponential backoff (0.5 s to 8 s, 5 tries). It uses a token prefetched 30 s before expiry and resumes via `conversation_id`.

## Voice identity
- Migration: `supabase/migrations/20261022190000_character_voice.sql`.
- `PUT /api/voice/:id {voice_id}` handles a built-in voice, or a console-cloned 8-char id. Console ids are verified with `GET /v1/custom-voices/{id}` and require consent.
- `POST /api/voice/:id/clone {dataUrl, consent:true}` clones from a clip:
  - The 120 s limit is checked from the WAV header (or the client-measured duration).
  - Size cap is 15 MB. Reference audio is **not** stored by us.
  - A 403 maps to `xai_clone_not_enabled`, telling the user to clone in the console and paste the id.
- Every save calls `save_voice_version()`: an immutable `character_voice` row, then a new `character_identity_core` version (`voice.realtime`, `voice_version`), then a `voice_changed` memory event.

## Secrets / env
| Name | Where | Notes |
| --- | --- | --- |
| `XAI_API_KEY` | Cloudflare Secrets Store or `wrangler secret put` (**never** `VITE_*`) | Already in the mirrored env list. Create the store secret **before** adding a `secrets_store_secrets` binding, or deploy fails. |
| `ANIMA_VOICE_AGENT=xai` | Worker var | Explicit opt-in. The chat stack is otherwise fail-closed to the self-hosted Anima LLM, and the voice agent sends persona plus memories to xAI. |
| `ANIMA_VOICE_MODEL` | var | Default `grok-voice-latest`. Pin `grok-voice-3.0` in production. |
| `ANIMA_VOICE_SHARE_MEMORY` | var | `off` keeps memory-core text out of the xAI instructions. |
| `ANIMA_VOICE_TOKEN_TTL_S` | var | Client secret TTL, 30–3600, default 300. |
| `VITE_SERENITY_VOICE=off` | build | Hides the launcher. |

## Testing note
The box has no `XAI_API_KEY`, so nothing here has made a live call. The unit tests cover:
- the opt-in gate;
- model pinning;
- WAV duration;
- instructions and tools;
- settings sanitizing;
- PCM conversion;
- the latency tracker.

A real end-to-end test needs the key, `ANIMA_VOICE_AGENT=xai` and the migrations applied.
