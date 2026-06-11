- [ ] Inspect and modify backend Clerk middleware integration for protected store routes
  - [ ] Update `artifacts/api-server/src/app.ts` to mount Clerk modern middleware (`clerkMiddleware()`)
  - [ ] Update `artifacts/api-server/src/routes/store.ts` to use `ClerkExpressRequireAuth()` (or `req.auth`) instead of `getAuth(req)`
- [ ] Adjust frontend Clerk token wiring to use `useAuth().getToken()`
  - [ ] Locate where `setAuthTokenGetter()` is called
  - [ ] Update it to call `getToken()` from `useAuth()`
- [ ] Run build/typecheck/tests
- [ ] Validate the Marvel “change series” → “Add 10” flow no longer returns the session error

