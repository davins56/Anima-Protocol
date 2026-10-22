import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { listPhotos } from "@/lib/photo/photoApi";
import { getTimelineEvents } from "@/features/belonging/relationshipApi";
import { buildPhotoAlbum } from "@/features/belonging/belonging";
import { apiUrl } from "@/lib/apiOrigin";

/** API returns `/api/photo/images/:id/file`; resolve against the API origin. */
function photoSrc(url) {
  if (!url) return "";
  if (/^https?:/.test(url)) return url;
  return apiUrl(url.replace(/^\/api/, ""));
}

/**
 * Photo Moments — a per-companion album. Photos come from /api/photo/images
 * (identity-locked generations); sections are the relationship timeline's
 * milestones/firsts/chapters (relationshipTimeline.ts), so each picture sits
 * under the moment it followed.
 */
export default function PhotoMoments({ api }) {
  const { characterId = "" } = useParams();
  const client = api || { listPhotos, getTimelineEvents };
  const [state, setState] = useState({ loading: true, sections: [], error: "" });

  useEffect(() => {
    if (!characterId) return undefined;
    let live = true;
    Promise.all([
      client.listPhotos({ characterId, limit: 60 }),
      client.getTimelineEvents(characterId, { limit: 60 }).catch(() => []),
    ])
      .then(([photos, events]) => live && setState({ loading: false, sections: buildPhotoAlbum(photos || [], events || []), error: "" }))
      .catch(() => live && setState({ loading: false, sections: [], error: "Couldn't load photos right now." }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 space-y-6" data-testid="photo-moments">
      <header className="flex items-center gap-3">
        <Link to="/" className="text-primary/60 hover:text-primary" aria-label="Back to Home">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="font-mono text-lg text-primary tracking-[0.2em] uppercase">Photo Moments</h1>
      </header>
      {state.loading && <p className="font-mono text-xs text-primary/40">Loading…</p>}
      {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
      {!state.loading && !state.error && state.sections.length === 0 && (
        <p className="text-sm text-primary/60">No photos yet. Ask her for one in chat and it'll land here.</p>
      )}
      {state.sections.map((section) => (
        <section key={section.key} className="space-y-2" data-testid="album-section">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary/70">
            {section.title}
            {section.at ? (
              <span className="ml-2 text-primary/40">{new Date(section.at).toLocaleDateString()}</span>
            ) : null}
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {section.photos.map((p) => (
              <figure key={p.id} className="aspect-square overflow-hidden border border-primary/15 bg-black/40">
                <img src={photoSrc(p.url)} alt={p.user_prompt || "Photo moment"} loading="lazy" className="w-full h-full object-cover" />
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
