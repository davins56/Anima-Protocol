---
name: Anima onboarding gate
description: How first-run onboarding is gated at "/" and how Serenity relates to the user's Anima.
---

# Anima onboarding gate (Serenity is the guide, not the companion)

Serenity is the **first Anima / symbolic guide** ("belongs to Dàvīn"), NOT the user's companion.
She is intentionally only surfaced inside the onboarding intro. She is NOT seeded as an `Anima`
entity for accounts — `Anima.create` only happens in user flows (onboarding, Animas page,
CreateCompanionModal). In Chat she's an *ambient* companion found by name
(`a.name?.toLowerCase() === "serenity"`), silent unless addressed.

## Detecting "user has their own Anima"
A user's primary companion = the `Anima` with `assigned_user === me.email`. For the first-run
gate we treat **any** `Anima.list()` result (length > 0) as "onboarded", since there is no seeded
Serenity Anima to false-positive on. New accounts have zero Animas → onboarding.

## The gate
`SignedInHome` (in `App.full.jsx`, inside `HomeGate`'s signed-in branch) fetches
`Anima.list("-created_date", 1)` ONCE on mount and routes: 0 → `<OnboardingFlow>`, else `<MainHome>`.

**Why the `onComplete` callback matters:** the gate evaluates only on mount (`[]` deps). When
onboarding runs *inside* the gate at "/", finishing with `navigate('/')` does NOT remount the gate
(same route) → user stays stuck on the farewell screen. So `OnboardingFlow` accepts an `onComplete`
prop; `SignedInHome` passes `() => setState("home")` to flip the gate. Standalone `/onboarding`
route (no prop) falls back to `navigate('/')`.

**Why fail-open to home on lookup error:** failing to onboarding instead would show a returning
user (who already has an Anima) the creation flow on a transient error → duplicate Anima. So the
gate fails open to `MainHome`; a true new user just gets onboarding on the next load.

## Don't reintroduce Serenity as a default
Name fallbacks for a missing Anima must stay neutral ("your Anima" / "Anima"), never "Serenity":
`MainHome.jsx` greeting + aria/title, `WelcomeScreen.jsx` `animaName` initial state + fallbacks.
`lib/chatMessageHandler.js` still has a "Serenity" fallback but is **dead code** (never imported).
