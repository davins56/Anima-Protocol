---
name: Anima Undo / delete-flow tests
description: How to unit-test delete/undo flows in anima-protocol without a server
---

- The server-backed `@/api/base44Client` blocks every CRUD call until a Clerk
  token getter is registered (`getToken()` awaits a never-resolving promise when
  none is set). So any vitest file importing the *real* base44 (e.g. the original
  `undoableDelete.test.js`) hangs and times out with no server + no token getter.
- To test delete/undo logic deterministically, `vi.mock("@/api/base44Client", …)`
  with a tiny in-memory store whose `update()` upserts by id (mirrors the real
  client, which is what makes undo/restore work). Also `vi.mock("sonner")` and
  reach into `toast.mock.calls[...][1].action.onClick` to trigger Undo.
- Page-level delete flows that live as closures inside the huge `Chat.jsx`
  component were extracted to `src/lib/chatDeleteHandlers.js` (`deleteSessionFlow`,
  `deleteMessageFlow`) as dependency-injected functions so they can be tested
  without rendering Chat. Chat.jsx just calls them with its closure values.

**Why:** rendering Chat.jsx (2100+ lines, many contexts/hooks) for a unit test is
impractical, and the real base44 needs auth + a running api-server.
**How to apply:** when adding tests for other page handlers, prefer the same
extract-to-DI-function + mock-base44 pattern over rendering the page.

- The in-memory base44 mock uses a module-level `stores` Map that persists across
  tests in a file. Any test asserting global `list()` length leaks records from
  earlier tests. Expose `__resetStore()` from the mock factory (clear stores + id
  counter) and call it in `beforeEach`.
- The anima-protocol `test` script (`pnpm --filter @workspace/anima-protocol run test`)
  is registered as the `test` validation step so the undo tests run as a CI-style gate.
