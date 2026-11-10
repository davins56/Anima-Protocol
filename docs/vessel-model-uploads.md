# Vessel model uploads

Backend support for steward-uploaded VRM (and GLB) models that attach to a
companion's versioned 3D vessel. The file never passes through the Cloudflare
Worker body. The Anima 3D Visual frontend owns VRM loading, expressions, and
lip-sync; this document is the contract it can rely on.

## What was added

| Piece | Path |
| --- | --- |
| Private bucket + owner-only storage RLS | `supabase/migrations/20261110220000_character_models.sql` |
| Signed upload / range read / signed download | `artifacts/api-server/src/lib/vessel/modelStorage.ts` |
| GLB header + VRM metadata inspect | `artifacts/api-server/src/lib/vessel/modelInspect.ts` |
| Schema 2 sanitizer (fail-closed URL allowlist) | `artifacts/api-server/src/lib/vessel/vesselStore.ts` |
| Routes | `POST/GET /api/vessel/:characterId/model/*` in `routes/vessel.ts` |
| Client zod + API helpers | `artifacts/anima-protocol/src/lib/vessel/vesselConfig.ts`, `vesselApi.ts` |

There is no pending-upload table. The object key is
`{clerk_user_id}/{character_id}/{uuid}.{vrm|glb}`, which already binds the
signed URL to that user and companion. `POST .../complete` checks the prefix
before reading any bytes. Abandoned incomplete uploads may linger in the
bucket; a janitor can delete unreferenced objects later.

## Formats and size

- Accepted: single-file `.vrm` (primary) and `.glb` (GLB container, same
  magic). VRM 0.x (`extensions.VRM`) and VRM 1.0 (`extensions.VRMC_vrm`) are
  both recognised.
- Rejected: `.fbx`, multi-file `.gltf` (external textures would break
  single-object storage), anything that is not a glTF 2.0 GLB.
- A `.vrm` object that does not declare `VRM` or `VRMC_vrm` in `extensionsUsed`
  or `extensions` is rejected and deleted.
- A `.glb` that does declare a VRM extension is recorded as `kind: "vrm"`,
  `format: "vrm"`.
- Cap: **50 MB** (`52428800` on the bucket and in the API). Declared size is
  checked on `sign`; stored size is checked on `complete`.

## Routes

All routes require a Clerk session. The character must exist as a
`user_entities` row (`entity_name` `Character` or `Anima`) for that `userId`.
Another user's character id returns 404.

### `POST /api/vessel/:characterId/model/sign`

Body: `{ byteSize: number, filename?: string, ext?: "vrm" | "glb" }`.

Returns 201:

```json
{
  "bucket": "character-models",
  "path": "user_2abc/char-id/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.vrm",
  "uploadUrl": "https://<project>.supabase.co/storage/v1/object/upload/sign/...",
  "token": "...",
  "expiresIn": 600,
  "maxBytes": 52428800,
  "contentType": "model/vrm"
}
```

The client uploads **directly** to `uploadUrl` (Bearer `token`, body = the
file, `Content-Type` as given). Do not POST the file to `/api`.

### `POST /api/vessel/:characterId/model/complete`

Body: `{ path: string }` (the path returned by `sign`).

The API, using the service role and without buffering the whole file:

1. Confirms the path is under `{userId}/{characterId}/`.
2. Reads object metadata (size).
3. Range-reads the 20-byte GLB prefix, then only the first JSON chunk
   (capped at 8 MB). The binary chunk is never downloaded.
4. Extracts metadata (below). On inspection failure the object is deleted and
   the response is 4xx.
5. Writes a new immutable `character_vessel` version via `save_vessel_version()`
   with `model.url = "/api/vessel/:characterId/model"` plus metadata. One
   model per companion: the latest version is current; replacing is a new
   upload + a new version.

### `GET /api/vessel/:characterId/model`

Owner only. Default: 302 to a short-lived signed download URL for the current
vessel's object. `Cache-Control: private, no-store`. There is no model when
`config.model.path` is missing (404 JSON `{ error, code }`).

With `?as=json`, the same auth, lookup, and signing run, but the response is
200 JSON instead of a redirect:

```json
{ "url": "https://…/storage/v1/object/sign/character-models/…?token=…", "expiresIn": 3600 }
```

- `url` — short-lived signed download URL. Do not persist it; fetch a new one
  when it expires or when loading the model.
- `expiresIn` — lifetime in seconds (currently 3600).
- `Cache-Control: no-store`.
- Errors stay JSON: 401 unauthenticated, 404 if the caller does not own the
  character or no model is stored, 403 if the stored path is outside the
  owner's prefix.

Client helpers: `signVesselModel`, `completeVesselModel`, `vesselModelUrl`,
`fetchVesselModelUrl` in `vesselApi.ts`.

## VesselConfig schema 2 — `model` object

`schema` is `2`. Schema 1 input is still accepted and re-emitted as 2. Unknown
keys are dropped.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `procedural` \| `gltf` \| `vrm` | `vrm` when a VRM extension is present |
| `url` | string | Same-origin `/api/vessel/:characterId/model`, or `https://` + `.vrm`/`.glb` on `VESSEL_MODEL_URL_HOSTS` (default empty) |
| `bucket` | string | `character-models` |
| `path` | string | Storage key, owner-prefixed |
| `format` | `vrm` \| `glb` | |
| `byteSize` | number | Bytes in storage |
| `expressions` | string[] | VRM 1.0 preset + custom names, or VRM 0.x `blendShapeGroups[].name`. Capped at 64, 40 chars each |
| `visemes` | `aa` `ih` `ou` `ee` `oh`[] | Intersection of those names with `expressions` |
| `humanoid` | boolean | A VRM humanoid bone map is present |
| `animationCount` | number | `gltf.animations.length` |

There is **no file checksum**. Hashing a 50 MB object would require streaming
the entire file through the Worker (128 MB isolate, CPU budget). The inspect
path only range-reads the JSON chunk. Integrity is the GLB magic / version /
JSON parse, the 50 MB cap, and Storage's own object metadata.

## Frontend contract (Anima 3D Visual)

1. Load the mesh from `GET /api/vessel/:characterId/model` (credentials
   included) or from `vesselModelUrl(characterId)`, and follow the 302. Or call
   `fetchVesselModelUrl(characterId)` (`GET .../model?as=json`) and use
   `{ url, expiresIn }`. Do not persist the signed URL; request a new one when
   it expires.
2. Read expression and viseme *names* from `vessel.config.model` (schema 2).
   The backend does not retarget or play them.
3. VRM expressions and visemes (`aa`, `ih`, `ou`, `ee`, `oh`) are expected to
   be driven with `@pixiv/three-vrm`. That package is not installed today;
   `VesselModel` still loads any URL through `useGLTF` as a static glTF.
   Wiring lip-sync and expressions is frontend work.
4. `vesselToBattleModel` currently forwards a URL only when `kind === "gltf"`,
   so VRM URLs are dropped on the battle/sim path until that map is updated.
5. `VesselCustomizer` has no upload UI yet. Use `signVesselModel` then
   `completeVesselModel` when adding one.

## Ops

1. **Apply the migration**
   `supabase/migrations/20261110220000_character_models.sql`
   on the Supabase project (SQL editor or CLI). It no-ops on plain Postgres
   (no `storage.buckets`). Confirm the bucket exists:

   `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'character-models';`

   Expected: `public = false`, `file_size_limit = 52428800`, MIME
   `model/gltf-binary`, `model/vrm`, `application/octet-stream`.

2. **Bucket CORS** so the browser can PUT the signed upload and so
   `useGLTF` / a VRM loader can GET the signed download from the app origin.
   In Storage → character-models → CORS, allow the production origin
   (and preview origins if needed):

   ```json
   [
     {
       "origin": "https://anima-protocol.com",
       "methods": ["GET", "HEAD", "PUT", "POST"],
       "headers": ["authorization", "apikey", "content-type", "x-upsert", "range"],
       "maxAge": 3600
     }
   ]
   ```

   Adjust the origin list; do not use `*`.

3. **Env** (Worker / Secrets Store, never `VITE_*` for the service role):

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_MODEL_BUCKET` (optional, default `character-models`)
   - `VESSEL_MODEL_URL_HOSTS` (optional, comma-separated hostnames). Leave
     empty unless you also serve first-party models from a CDN. Uploaded
     models use the same-origin `/api/vessel/:id/model` path, not this list.

4. `character_vessel` and `save_vessel_version()` already exist
   (`20261022170000_character_vessel.sql`). This work does not add a Drizzle
   table and does not change `ensure-schema.ts`. A database recovered only
   with `ensureSchema` still needs the vessel migrations applied or vessel
   routes will 503 `vessel_schema_missing`.

5. Do not deploy from this branch until it is reviewed and merged.

## Frontend implementation (feature/vessel-model-uploads-frontend)

| Piece | Path |
| --- | --- |
| Fetch bytes via the API route, re-fetch on expired signed URL, short byte cache | `src/lib/vessel/vesselModelAsset.ts` |
| GLTFLoader + `VRMLoaderPlugin`, `VRMUtils` optimise / `rotateVRM0` / `deepDispose` | `src/lib/vessel/vrmRuntime.ts` |
| Mood → VRM presets, auto-blink, easing | `src/lib/vessel/vrmExpressions.ts` |
| `getVisemeOpenness` / voice level → `aa ih ou ee oh` | `src/lib/vessel/vrmVisemes.ts` |
| R3F renderer (Suspense + error boundary, procedural fallback) | `src/components/vessel/UploadedVessel.tsx` |
| Validate → sign → PUT (XHR progress) → complete | `src/lib/vessel/vesselModelUpload.ts`, `src/components/vessel/VesselModelUpload.tsx` |

Paths are relative to `artifacts/anima-protocol/`. The browser requests
`apiUrl('/vessel/:id/model')` with the Clerk bearer and `credentials:
"same-origin"`, follows the 302, and reads the bytes immediately; the signed
URL is never stored. A 400/401/403 on that request is treated as an expired
signed URL (or token) and retried once through the API. The signed hop is a
cross-origin GET without credentials, so bucket CORS only needs the app
origin (no `Access-Control-Allow-Credentials`).
