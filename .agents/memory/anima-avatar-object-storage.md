---
name: Anima avatar object storage
description: How user/AI portrait uploads are stored as real files (object storage) and the AI-edit re-edit constraint
---

User-picked and AI-edited Anima portraits are stored as real files in object
storage, not base64 in the DB and not a null stub.

**Why:** base64-in-DB bloats rows and doesn't share across the entity store
cleanly; the old null stub lost uploads on refresh. Real files persist and sync
cross-device.

Durable decisions / constraints:
- Avatars are served **publicly with no ACL check** because they load in plain
  `<img>` tags that cannot send auth headers. Keep this an explicit privacy
  decision — only non-sensitive portraits live here.
- Persist a **root-relative** served path (`/api/storage/objects/...`), never an
  absolute origin URL, so avatars stay portable across dev preview / deployment
  / custom domains.
- The AI image-edit endpoint ONLY accepts `data:` URLs. Once an avatar is a
  stored path, it must be fetched and inlined back to a data URL before
  re-editing. Any "AI Edit existing" gate must allow BOTH `data:` (legacy) and
  `/api/storage` prefixes — gating on `data:` alone silently hides the button
  for storage-backed avatars.
- Follow this repo's hand-written express-router style for storage routes (NOT
  the OpenAPI/zod codegen or Uppy flow).

Operational gotchas:
- `@google-cloud/*` is externalized in api-server's esbuild config, so it must be
  installed as a real dependency (it won't be bundled).
- The object-storage template's `objectStorage.ts` needs an explicit cast on the
  signing `response.json()` or api-server's strict typecheck fails.
