/**
 * Mythic HUD chip — only after a storm offer. Not a fight button on every bubble.
 */
export default function JackInOfferChip({
  entityName,
  onAccept,
  onReturn,
  disabled = false,
}) {
  return (
    <div
      className="mx-2 mb-1 flex items-center justify-between gap-2 border border-amber-200/25 bg-amber-950/20 px-3 py-2"
      data-jack-in-offer
    >
      <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-amber-100/80 leading-relaxed">
        {entityName || "Halo.Vrs"} is in the lattice. She offered jack-in.
      </p>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onReturn ? (
          <button
            type="button"
            onClick={onReturn}
            disabled={disabled}
            className="font-mono text-[8px] tracking-[0.2em] uppercase text-cyan-200/70 hover:text-cyan-100"
          >
            Stay
          </button>
        ) : null}
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="font-mono text-[8px] tracking-[0.22em] uppercase text-amber-100 border border-amber-200/40 px-2.5 py-1 hover:bg-amber-200/10 disabled:opacity-40"
        >
          Jack in
        </button>
      </div>
    </div>
  );
}
