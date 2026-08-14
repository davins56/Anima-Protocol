---
name: Anima voice / TTS architecture
description: How ElevenLabs voice is wired in Anima Protocol and the gotchas around it.
---

# Anima Protocol — voice / TTS

Rule: ElevenLabs speech goes through a **dedicated binary route** `POST /api/tts`
(returns `audio/mpeg` bytes) on the api-server, consumed client-side via
`res.blob()` + `new Audio()`. It does **not** go through `base44.functions.invoke`
— that path is JSON-only and its `elevenLabsTTS` case is a stub returning
`{audio:null}`. An older hook implementation pointed at a dead
`/api/apps/<appId>/functions/<ver>/...` path that never existed on this server.

**Why:** TTS is binary; the JSON function dispatcher cannot return audio. Anyone
re-adding voice via `functions.invoke` will silently get no audio.

**How to apply:**
- Voice key is `ELEVENLABS_API_KEY` (secret). Without it, `/api/tts` returns 503.
- The route maps `emotion` + `intensity` (0–10) to ElevenLabs `voice_settings`
  (stability/style) for expressive delivery; default voice id is overridable via
  `ELEVENLABS_VOICE_ID`.
- Two client speak paths exist in Chat.jsx: `speakMessage` (manual replay button)
  and `speakMessageNative` (auto-play of the latest AI message, also handles the
  iOS WKWebView native bridge). **Auto-play uses `speakMessageNative`** — any
  change to fallback logic must be mirrored in BOTH or auto-speak silently breaks.
- Both paths fall back to the server **default voice** when a character has no
  cloned `elevenlabs_voice_id`, so voice works without per-character clones.

Resonance Field (`useResonance.js`) deepens EMOTIONAL intimacy/presence only via
a prompt-guidance string — by design it never escalates to anatomical/explicit
content, independent of the separate global adult-mode toggle.

User-state context (check-in + journal, via `useVesselContext.js`) is injected
into the solo system prompt. It is USER-AUTHORED = untrusted: it must be
sanitized (strip instruction-like phrases, collapse newlines) and wrapped in
explicit DATA-ONLY delimiters before going anywhere near the system prompt.
**Why:** raw user text in system-instruction space is a prompt-injection path
that can override the no-explicit-content boundary. Same rule applies to any
future user-authored data piped into prompts here.

Boundary precedence in the solo prompt: the global adult-mode / behavior-config
instructions (built earlier in handleSendMessage) can PERMIT explicit content
and will silently override any "never explicit" clause a new feature adds —
conflicting instructions in one prompt are non-deterministic.
**Why/How:** when a new feature must stay non-explicit (e.g. multi-aspect
"Lover Matrix"), don't just append a boundary line — SUPPRESS the permissive
adult/behavior strings for that path AND append a final highest-priority
override clause at the very end of the prompt (last line wins).
