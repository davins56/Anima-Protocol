---
name: Anima SSE push hardening
description: Constraints for the cross-device instant-sync SSE transport (client parsing, heartbeat watchdog, multi-instance fan-out).
---

# Anima instant-sync (SSE) transport hardening

The live cross-device push is a fetch-streamed SSE in
`artifacts/anima-protocol/src/api/base44Client.js` (connectSse), fed by
`artifacts/api-server` GET /api/store/events; polling /revision is the safety net.

## Durable constraints
- **CRLF tolerance is required.** Client must collapse `\r\n`→`\n` before splitting
  on `\n\n`, because some proxies/CDNs normalize newlines and deliver event blocks
  as `\r\n\r\n`. Do not revert to plain `\n\n`-only splitting.
  **Why:** without it, a normalizing proxy makes every push silently invisible and
  users drop to slow polling with no signal.
- **Client heartbeat watchdog window must stay > 2× the server heartbeat.** Server
  beats every 25s (routes/store.ts); client watchdog is 60s. If you change either,
  keep the watchdog ≥ ~2 missed beats + slack or healthy streams will needlessly
  reconnect. Watchdog is armed on connect and re-armed on EVERY chunk (any bytes —
  event, heartbeat, or `:` comment — prove liveness); firing aborts the stream so
  connectSse's finally reconnects.

## Observability
- Transport transitions emit once per change: a `console.info` line AND an
  `anima:sync-mode` window CustomEvent `{ mode: 'push' | 'polling' }`. All
  `sseConnected` writes go through `setSseConnected` so the signal can't drift.
  Gated on `syncStarted` so clean sign-out doesn't log a false "polling".

## Multi-instance caveat
- `storeEvents.ts` registry is process-local: fan-out only reaches streams on the
  same api-server process. Scale-out (multiple instances) needs shared pub/sub
  (Redis / Postgres LISTEN-NOTIFY). Correctness survives via polling; only the
  instant feel is lost cross-instance. Run single-instance until then.
