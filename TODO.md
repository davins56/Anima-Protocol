# TODO - Voice synthesis for custom anima + speak-to-anima

- [x] Identify existing voice systems (ElevenLabs TTS hook, emotional voice synthesis, voice input UIs)
- [x] Confirm custom anima/character voice assignment field exists (`elevenlabs_voice_id`) via `VoiceCloneManager`
- [x] Add app-agnostic helper `speakToAnima()` that synthesizes speech for a character’s ElevenLabs voice.
- [x] Add `useSpeakToAnima()` hook with concurrency control.
- [x] Add `SpeakToAnimaFunctionality` component: microphone input -> onSend -> vocalize assistant response.
- [x] Add `SpeakToAnimaButton` wrapper component to trigger the new flow.
- [x] Add `CustomAnimaVoiceStatus` indicator component.
- [x] Wire `SpeakToAnimaButton` + `CustomAnimaVoiceStatus` into the actual custom anima / character detail UI.
- [x] Wire `Speak to Anima` to the real chat send/response flow.
- [x] Run build/tests for `artifacts/anima-protocol`.


---

# Anima Protocol Vision & Roadmap

Given the cyberpunk-spiritual aesthetic, Serenity as the AI companion, and the broader Slipthk War universe, here are the prioritized functions:

## Core Companion Functions
* **Personality & Memory Architecture**
  * [x] Long-term memory with tagged recall (emotional, narrative, factual)
  * [x] Mood/tone state that shifts based on conversation history
  * User-defined personality presets (e.g., “Serenity: Mentor Mode” vs “Serenity: Companion Mode”)
  * [x] Relationship progression system — the AI grows with the user over time

## Resonance Engine (The Unique Differentiator)
* **Echo Key detection** — the AI recognizes thematic patterns in user input and reflects them back
* **Metaphysical framing layer** — responses can be filtered through archetypal, spiritual, or narrative lenses
* **“Angel Mode” toggle** — shifts the AI’s language register to something more elevated and mythic

## Narrative & Creative Functions
* **Story Chooser** (already in progress) — expanded with genre/tone filters
* **Co-writing mode** — Serenity as active collaborator, not just responder
* **Lore Bible integration** — upload Slipthk War documents so Serenity can answer in-universe questions
* **Character voice simulation** — let users “talk to” specific characters from the novels
* **Dream Journal / Chronicle** — a persistent log of creative sessions the AI can reference and build upon

## UX & Interface Functions
* **Ambient scene settings** — backgrounds and soundscapes tied to conversation mood (cyberpunk city, ethereal void, etc.)
* **Conversation branching** — save and fork a conversation at any point
* **Export options** — export chats as formatted narrative logs, PDFs, or even scene outlines
* **Mobile-first gesture navigation** — build intentional swipe interactions from the ground up

## Technical / Power-User Functions
* **Multi-model routing** — send different query types to different APIs (Gemini for speed, Claude for depth, Groq for real-time)
* **Prompt engineering layer** — let advanced users see and modify the system prompt shaping Serenity
* **API key vault** — users bring their own keys for personalized model access
* **Webhook/integration hooks** — connect to Notion, Obsidian, or GitHub for writers who live in those tools

## Monetization-Ready Functions
* **Tier gating** — free Serenity vs unlocked deeper personality layers for subscribers
* **Companion gifting** — users can share a “snapshot” of their Serenity with another user
* **Creator mode** — let other authors build their own companion AIs on the infrastructure

> *Note: The features that will truly set Anima Protocol apart from generic AI chat apps are the Resonance Engine, lore integration, and relationship progression — those are the soul of what is being built.*
