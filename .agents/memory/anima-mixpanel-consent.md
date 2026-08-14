---
name: Anima Mixpanel consent gating
description: Why the consent banner must use its own localStorage flag, not mixpanel's opt-state
---

# Mixpanel consent gating in Anima

## The trap: opt_out_tracking_by_default poisons "needsConsentDecision"

The analytics wrapper inits mixpanel with `opt_out_tracking_by_default: true`
(required for EU/CA). **Consequence:** `mixpanel.has_opted_out_tracking()`
returns `true` for a brand-new user immediately — indistinguishable from a real
decline. So deriving "has the user decided yet?" from mixpanel's opt-state makes
the "needs decision?" check always false → **the consent banner never shows**.

**Rule:** keep an explicit decision flag in our own localStorage
(`anima_analytics_consent` = `'granted'|'declined'`). "Needs decision" ⇔ flag is
absent. grant/revoke write the flag AND call mixpanel opt_in/opt_out; on init,
re-apply the persisted flag so the flag and mixpanel's opt-state never drift.

**Why:** the GDPR default (opt-out) and "user hasn't chosen" are the same
mixpanel state; only a separate flag distinguishes them.

## Expected dev noise

Repeated `Mixpanel warning: You are opted out of Mixpanel tracking` pre-consent
is CORRECT — it proves identity/track calls fire but send nothing until accept.
Not a bug. (Tracking plan + file map live in root `AGENTS.md`.)
