# App Intents / Siri ("Talk to Serenity")

Anima ships as a web app / PWA. There are two ways to get Siri or Shortcuts entry points:

## 1. PWA today (no native code)
- **Shortcuts → "Open URL":** `https://anima-protocol.com/chat?voice=1&character=<id>`. `VoiceLauncher` auto-opens the voice panel when it sees `voice=1`. iPadOS still needs one tap to start audio, because an AudioContext and mic access require a user gesture.
- **Web App Manifest `shortcuts`:** add entries for `/resonance` and `/vessel` (long-press on the Home Screen icon).

## 2. Capacitor wrapper (native App Intents)
1. Run `npx cap init` and `npx cap add ios`, serving the Vite build.
2. Add `ios/AnimaIntents/SerenityIntents.swift` (stub in this repo) to the app target. It defines:
   - `TalkToCompanionIntent` (opens the app at `/chat?voice=1&character=…`)
   - `OpenResonanceIntent`
   - `ShowVesselIntent`
   - an `AppShortcutsProvider` with the phrases "Talk to Serenity in Anima", "Open resonance scanner in Anima", and "Show my vessel in Anima".
3. Handle the URL in Capacitor (`App.addListener('appUrlOpen')`) and route with react-router.
4. With native audio, the mic and AudioContext gesture restriction is relaxed. The realtime socket and ephemeral token flow stay identical. **Never** embed `XAI_API_KEY` in the app.

Background voice (screen locked) needs a native audio session (`AVAudioSession .playAndRecord`) and is out of scope for the web build.
