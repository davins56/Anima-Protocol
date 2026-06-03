---
name: Anima user-context (background docs/photos) pipeline
description: How uploaded background context is processed/persisted, and the two non-obvious gaps around file storage and live Chat wiring.
---

# Anima user-context pipeline

Background uploads (novels, journals, character sheets, reference photos) are
distilled by the api-server `processUserContext` / `buildUserContextPrompt`
functions (in `artifacts/api-server/src/routes/openai/functions.ts`, switch in
the `/invoke/:fnName` route) into a compact `ContextAnalysis` shape stored on the
`UserContext` row in `user_entities`.

**No real file storage.** `UploadFile` in `base44Client.js` is a stub returning
`{ url: null }` — there is no object storage and no fetchable file URL. So the
server CANNOT fetch an uploaded file. Anything that needs server-side reading of
an upload must receive the bytes **inline** (the upload modal sends a downscaled
image as `image_data_url`, a `data:` URL). Image context uses gpt-4o vision on
that data URL; text context uses `file_content` (works for .txt/.md).
**Why:** PDFs can't be read server-side here (no storage to fetch them) — that's
an architecture limit, not a bug. PDF/document ingestion needs object storage
first.

**context_prompt is NOT wired into live Chat.** `useUserContext` /
`buildUserContextPrompt` produce a `context_prompt`, but nothing consumes it in
the Chat page — the user-context block never reaches the live AI prompt. This is
a pre-existing gap; processing+persistence works, but surfacing it to the
companion is separate, unfinished work. (Live prompt assembly is in `Chat.jsx`
`handleSendMessage` — see anima-chat-prompt-path.md.)

**Auth/denial-of-wallet:** `clerkMiddleware` in app.ts only *attaches* auth, it
does not reject anonymous requests. Any function case that calls a paid model
must gate on `getAuth(req).userId` itself before invoking OpenAI (processUserContext
returns 401 when unauthenticated).
