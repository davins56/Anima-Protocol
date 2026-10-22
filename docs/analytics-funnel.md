# Activation funnel (Mixpanel)

All events go through `track()` in `src/lib/analytics.js` (consent-gated, no PII).

| Step | Event | Fires when |
|---|---|---|
| 1 | `sign_up_completed` | First profile load for a new account |
| 2 | `onboarding_completed` | The onboarding Anima is saved on the server |
| 3 | `message_sent` | The user sends a chat message |
| 4 | `first_reply_received` | The first companion reply arrives (once per device; carries `first_word_ms`) |
| 5 | `subscription_upgrade_started` | Upgrade intent. While payments are not live, `purchase_type: "waitlist"` |

## Building it in Mixpanel

Reports → Funnels → add the five steps in order, conversion window 7 days,
counted by unique user. Breakdowns that matter: `platform` (step 1),
`is_anima` (step 4), `tier` (step 5).

`first_word_ms` is the server's request-arrival → first-visible-word time
(`ChatPipelineTelemetry.firstWordMs`, also logged as `first_word_ms` in
`chat.pipeline` logs). Use its median per platform as a latency guardrail.

## Caveats

- `first_reply_received` is once per device (localStorage flag), so a person
  on two devices can fire it twice. Mixpanel funnels count the first one.
- Events don't fire without analytics consent, so the funnel undercounts.
