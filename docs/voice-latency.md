# Voice latency: instrumentation & mitigation

**Metric:** end of user speech, then the first audio byte, then the first *audible* frame.
- `LatencyTracker` (`src/lib/voice/latency.ts`) marks `input_audio_buffer.speech_stopped`, the first `response.output_audio.delta`, and the worklet's `playing` transition.
- It keeps the last 50 samples with p50 and p95.
- The per-turn value is stored in the voice `turn` memory event payload (`latency_ms`).
- **Dev HUD:** `VoiceLatencyHud` shows in dev builds or with `?voicehud=1`. Green < 800 ms, amber < 1.5 s, red above that.

## Mitigations (in order of impact)
1. **Parallel init (implemented).**
   - Mic capture and the WebSocket start together, and early audio is buffered.
   - The token is minted server-side in parallel with building the session.
   - The token is prefetched 30 s before expiry so reconnects never wait on the Worker.
2. **Stream immediately (implemented).** Deltas go straight into the AudioWorklet queue, with `latencyHint: "interactive"`. Audio is 24 kHz PCM end-to-end, so the server does no resampling.
3. **Reasoning effort.** `reasoning.effort` defaults to `high`. Set `settings.reasoning_effort = "none"` on the character voice for snappier small talk, at a quality trade-off.
4. **Filler / backchannel during tools.** For slow tools (photo generation takes seconds), you can send a documented `force_message` such as "Give me a sec…" *before* the tool outputs.
   - Not enabled by default: a force_message is its own turn and must not race `response.create`.
   - Gate it behind a per-tool flag once it's tested live.
5. **Prefetch context.** Memory-core recall for the opening instructions runs while the token is being minted. A future step is to refresh instructions mid-session with `session.update` after `recall_memories`.
6. **Regional endpoint: not available.** Per docs.x.ai, `us.api.x.ai` serves no voice APIs, so use the global endpoint. Keep the Worker close to users; it isn't in the audio path, which is browser ↔ xAI directly.
7. **Binary transport.** `audio.*.transport: "binary"` (documented) removes base64 overhead, about 33% of bytes. It's a small win on cellular and a candidate once measured.
8. **Fallback: text + TTS.** If the realtime socket can't stay up (5 failed reconnects) or voice is disabled, use the existing chat route with streamed TTS. This keeps the self-hosted LLM path, and is already how `Chat.jsx` speaks replies (`speakNative` / ElevenLabs / `/v1/tts` with a server-held key). Wire `status === "error"` to that path as a follow-up.
