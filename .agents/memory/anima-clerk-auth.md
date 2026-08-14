---
name: Anima Clerk auth bridge
description: How Replit-managed Clerk is bridged into Anima Protocol's existing localStorage AuthContext, and the routing/identity contract.
---

# Anima Protocol — Clerk auth bridge

Clerk owns identity + session; the localStorage `base44` record (base44Client.js)
holds profile/settings the rest of the app reads via `base44.auth.me()`.

**The bridge (`src/lib/AuthContext.jsx`):**
- Reads Clerk `useUser`/`useClerk`; derives `isAuthenticated`/`isLoadingAuth` from
  Clerk, NOT from base44.
- On sign-in, merges Clerk identity into the local profile via
  `base44.auth.syncIdentity({id,email,full_name})`; on sign-out calls
  `base44.auth.clearSession()`.
- `logout()` clears the local profile then `signOut({ redirectUrl: '/' })`.
  **Why:** Clerk owns the post-logout redirect — signed-out users must land on
  the public Landing at `/`, never the bare `/sign-in` screen. `base44.auth.logout`
  was reduced to clear-only (its old redirect arg is now ignored at all callsites).

**Routing contract (App.full.jsx):**
- `BASE_URL` is `/`, so `basePath` is `""`; sign-in/up live at domain root
  (`/sign-in/*`, `/sign-up/*`, react-router wildcard — NOT wouter `/*?`).
- `"/"` renders `<HomeGate>` using Clerk `<Show when="signed-in/out">`:
  signed-in → MainHome, signed-out → Landing.
- A guard redirects signed-out users on protected routes to `/` (HomeGate shows
  Landing). `PUBLIC_PREFIXES` must mirror the real public routes — the legal
  route is `/terms` (NOT `/terms-of-use`), plus `/privacy-policy`, `/disclaimer`,
  `/landing`, `/login`, `/sign-in`, `/sign-up`.
- `showChrome` (authenticated + not on auth/landing pages) gates MobileHeader,
  BottomTabBar, AND the AIDisclaimerModal — otherwise the disclaimer overlays the
  Clerk sign-in form.

**Canonical wiring (copy verbatim, only theme is custom):** `clerkPubKey =
publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)`
from `@clerk/react/internal`; `proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL}`
unconditional (empty in dev, auto-populated in prod — do NOT gate on NODE_ENV).
Tailwind v4 needs `tailwindcss({ optimize: false })` + `@layer ... clerk ...;`
declared in index.css with appearance `cssLayerName: "clerk"`.
