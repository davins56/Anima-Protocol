---
name: Anima character photo lookup
description: How auto character portraits are fetched, and the Wikipedia API gotcha that makes fictional characters work.
---

# Character photo auto-lookup

Created characters auto-get a portrait via api-server `GET /api/character-image?name=&universe=`.

**Key Wikipedia gotcha:** the PageImages API (`prop=pageimages`) only returns *freely-licensed* (Commons) images, so it returns nothing for almost every fictional character (their lead images are fair-use). Use the **REST summary endpoint** (`/api/rest_v1/page/summary/<title>`) instead — it returns the article's actual lead image including fair-use art. Resolve the right title first via the search API (`list=search`), then hit the summary endpoint.
**Why:** spent a debug cycle getting `{url:null}` for every character before discovering PageImages excludes non-free images.

**Transient-vs-definitive retry rule:** `findCharacterPhoto` THROWS on network/non-OK; returns null only for a definitive no-match. The seedCharacters backfill marks a character "attempted" (localStorage `anima_photo_attempts_v1`) only after a definitive answer, and stops the run on a throw — so a temporary outage never permanently suppresses retries.
**Why:** original version marked attempted unconditionally, permanently leaving characters photoless after any transient failure.

Obscure characters legitimately return null → leave avatar_url empty (placeholder); do NOT generate images.

**Dead Fandom seed URLs — `<img onError>` can't detect them:** the starter roster (seedCharacters.js) hardcoded `static.wikia.nocookie.net` (Fandom) hotlinks that now HTTP 404. Fandom answers a missing file with a *valid* 300x171 "image not found" WebP, so the `<img>` decodes/loads successfully and `onError` NEVER fires — the card just shows Fandom's gray placeholder. Detection must be URL-based, not load-event-based: `photoNeedsLookup(url)` (exported from seedCharacters.js) treats empty OR `static.wikia.nocookie.net` URLs as "needs a real photo". Used in both the card render (show placeholder + on-demand "Find photo" button) and the backfill pending filter (auto-replace via the working Wikipedia endpoint on load).
**Why:** spent a cycle on an `onError` fix that did nothing because the broken URLs still "load".
