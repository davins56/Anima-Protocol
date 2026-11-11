import { useMemo, useState } from "react";
import { companionShareCard, shareCardSvg, shareCardText } from "@/lib/companions/shareCard";

/**
 * Preview + local share actions for an identity-only companion card.
 * Copy / Download SVG / the device share sheet — all user-initiated,
 * nothing uploaded or published.
 */
export default function ShareCompanionCard({ character, vessel }) {
  const card = useMemo(() => companionShareCard(character, vessel), [character, vessel]);
  const svg = useMemo(() => shareCardSvg(card), [card]);
  const [note, setNote] = useState("");
  const text = shareCardText(card);

  const download = () => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${card.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "companion"}-card.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section data-testid="share-companion-card" className="space-y-3">
      <div className="border border-primary/20" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="text-[10px] font-mono text-primary/50">Identity only — no memories, chats or private details.</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            navigator.clipboard
              ?.writeText(text)
              .then(() => setNote("Copied."))
              .catch(() => setNote("Couldn't copy."))
          }
          className="flex-1 min-h-[40px] border border-primary/30 font-mono text-[10px] uppercase tracking-widest text-primary/80"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={download}
          className="flex-1 min-h-[40px] border border-primary/30 font-mono text-[10px] uppercase tracking-widest text-primary/80"
        >
          Download
        </button>
        {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
          <button
            type="button"
            onClick={() => navigator.share({ title: card.name, text }).catch(() => {})}
            className="flex-1 min-h-[40px] border border-primary/30 font-mono text-[10px] uppercase tracking-widest text-primary/80"
          >
            Share
          </button>
        )}
      </div>
      {note && <p role="status" className="text-[10px] text-primary/60">{note}</p>}
    </section>
  );
}
