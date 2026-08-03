---
name: Anima auth token bridge contract
description: setAuthTokenGetter takes the token-getter directly — wrapping it in an extra arrow breaks every authenticated request.
---

# authBridge token getter contract

`setAuthTokenGetter(fn)` (src/api/authBridge.js) stores `fn` and later calls it
as `await tokenGetter(options)` to produce the bearer token. **`fn` IS the
token getter** — e.g. `setAuthTokenGetter(async () => token)`.

**The trap:** it looks like a React state setter, so it is tempting to write
`setAuthTokenGetter(() => async () => {...})` (the "pass a function to setState
without invoking it" idiom). That is WRONG here — it makes `tokenGetter()`
return the *inner async function itself*, so `await tokenGetter()` resolves to a
function, and ``Bearer ${token}`` stringifies the function body into the header.

**Symptoms when broken (both at once):**
- fetch throws `Header 'Authorization' has invalid value: 'Bearer async () => {…}'`
  on any "add characters" / write.
- "No preloaded characters" on first sign-in — starter seeding
  (`seedCharactersIfNeeded` via `syncBootstrap`/`bootstrapUserData`) goes through
  the same base44 → authBridge path, so a bad token header silently fails it too.

**How to apply:** when registering the Clerk token getter in AuthContext.jsx,
pass the async getter directly (single arrow). The unit contract is fixed by
`src/api/apiAuth.test.js` (`setAuthTokenGetter(() => 'test-token')` →
`Authorization: 'Bearer test-token'`).

**Defense in depth:** `authBridge.getToken()` unwraps one accidental extra
function layer and only returns strings, so a double-wrap no longer poisons
`Authorization` headers (add-from-series / character feature writes).

Note: `src/hooks/useSeedCharacters.ts` (POST /api/seed-characters) is DEAD code —
never imported and the endpoint does not exist on api-server. Real seeding is
`src/lib/seedCharacters.js`.
