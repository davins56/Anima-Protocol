---
name: Anima AI image edit
description: How inline base64 image payloads flow through api-server, and the body-limit constraint they impose.
---

# Anima AI image editing

The avatar "AI Edit" feature posts the source image inline as a base64 data URL
to `POST /api/openai/image-edit` (gpt-image-1 `images.edit`, Clerk-gated).

**Body-limit rule:** any api-server route that accepts an inline base64 image
must account for the global `express.json()` limit in `app.ts`. The default is
100KB, which a 512px JPEG avatar exceeds once base64-encoded. The global limit
is raised to 25mb; the route itself enforces a 20MB decoded-buffer cap.
**Why:** without the raised limit, edits silently fail with 413 before route
logic runs. **How to apply:** when adding any route that takes image/file data
URLs in JSON, verify the body-parser limit covers it.

**Client gating:** the backend only accepts `data:*;base64,...` images, so the
"AI Edit" button in `MainHome.jsx` is gated to `avatar_url.startsWith("data:")`.
Remote-URL avatars (e.g. Wikipedia character portraits) would 400 — gate or
convert to a data URL before calling `editImage`.

**Pre-existing quirk:** `/openai` mounts two routers (`openai/index` and
`openai/functions`) and both call `router.use(rateLimit)`, so requests to
functions routes are rate-limited twice. Affects the whole functions router, not
just image-edit.
