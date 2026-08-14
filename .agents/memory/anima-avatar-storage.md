---
name: Anima avatar storage
description: How the Anima companion's avatar_url is populated and the localStorage constraint on user-uploaded photos.
---

# Anima avatar (`Anima.avatar_url`)

The Anima companion is created (onboarding / CreateCompanionModal) WITHOUT an
`avatar_url`, so home surfaces fall back to the `/api/placeholder/150/150`
placeholder until one is set. Three ways it gets populated:
- `AnimaCustomizer` — AI-generated portrait via `base44.integrations.Core.GenerateImage` (remote URL).
- Seed characters use remote wiki/CDN URLs (these are Characters, not the Anima).
- MainHome avatar box — user uploads a local photo.

**Rule:** entities are localStorage-backed (`base44Client.js`). User-uploaded
photos MUST be downscaled to a small JPEG **data URL** before saving to
`avatar_url` (MainHome uses a canvas, max 512px, quality 0.85), or large images
risk `QuotaExceededError`.
**Why:** there is no object storage configured; the whole entity store lives in
localStorage, so raw full-size images would blow the quota and break persistence.
**How to apply:** any new "set anima/character photo from device" feature should
reuse the downscale-to-data-URL approach and surface quota errors to the user
rather than failing silently.
