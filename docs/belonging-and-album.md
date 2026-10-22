# Belonging on Home + Photo Moments album

## Belonging (anima-belonging → Home)

- `src/features/belonging/relationshipApi.js` ports the drop-in's typed
  client to this app. It uses `apiUrl` + the Clerk bearer, and the real mount
  `/api/relationship-os` (the drop-in assumed `/api/relationship`).
- `components/home/MemoryResurfacing.jsx` is the drop-in's "Picking back up"
  card without react-query. MainHome tests render without a
  QueryClientProvider. It shows unread journal entries and the latest
  chapter/milestone. It is dismissible, has no absence copy, and stays quiet
  on errors.
- The card is shown in `MainHome.jsx` above `HomeDock`. Opt out with
  `settings.belonging.allow_memory_resurfacing = false`.
- `HomeDock` gains a **Moments** item, shown only when Home has a companion.

## Photo Moments

`/moments/:characterId` (`pages/PhotoMoments.jsx`):

- Photos come from `GET /api/photo/images?characterId=` (`lib/photo/photoApi.ts`).
- Sections come from relationship timeline events of type milestone, first,
  chapter or breakthrough (`relationshipTimeline.ts`).
- `buildPhotoAlbum` puts each photo under the latest milestone at or before
  it. Photos from before any milestone go under "Early days".

## Remaining

- Timeline events are keyed by `anima_id`, photos by `character_id`. Home
  passes the Anima record id to both. A companion whose photos were made
  under a different character id shows no photos until the ids are aligned.
- The other drop-in pieces are not wired yet: JournalPrompt,
  IntensitySettings, ShareExport, useStoryProgress and lore consistency.
