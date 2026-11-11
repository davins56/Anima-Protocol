# Conversation style and adult mode

Settings → AI Behavior → Conversation Style has an opt-in **Creative freedom**
switch. Save Changes persists `settings.creative_freedom_enabled` on the user's
existing profile; no migration is needed. It defaults off for existing accounts.

The chat route reads the saved boolean, rather than trusting client prompt text.
Both local/hosted chat messages and the legacy prompt builder receive the same
style guidance: engage with unusual fiction and complex emotions, use natural
language, preserve user agency, and avoid unnecessary lectures for permitted
fiction. Therapy ignores this preference.

**Adult Content Mode** remains a separate preference and uses the existing
server age-attestation gate. Creative freedom does not enable it. Therapy,
crossover scenes, and Deep mode retain their existing non-adult policies.
Non-explicit romance is permitted in ordinary chats. Selecting a mode named
`adult` does not grant permissions without the server's adult decision.

These controls guide the selected model; they cannot remove its own content
restrictions or guarantee parity with another service. No model provider,
billing setting, image policy, or deployment configuration changes in this work.

## Validation

- `chatStyle.test.ts`: strict preference parsing, local/hosted/legacy prompt
  coverage, adult/style independence, and therapy isolation.
- `chatModeRegistry.test.ts`: requested-mode bypass regression and mode priority.
- `Settings.test.jsx`: save and reload the creative preference independently of
  adult mode.
