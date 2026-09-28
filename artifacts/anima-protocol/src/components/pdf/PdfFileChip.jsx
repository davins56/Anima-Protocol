import { FileText, X } from "lucide-react";

/**
 * Readable PDF chip for chat and lore. Sized for a finger on iPad, not a thumbnail.
 */
export default function PdfFileChip({
  name,
  pageCount,
  statusLabel,
  onRemove,
  removeLabel,
}) {
  return (
    <div
      data-testid="pdf-file-chip"
      className="flex items-center gap-2 min-h-11 max-w-full border border-primary/35 bg-black/75 px-3 py-1.5"
    >
      <FileText className="w-4 h-4 shrink-0 text-primary/80" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm text-primary/95 leading-snug break-words">
          {name || "PDF"}
        </p>
        <p className="font-mono text-[11px] text-primary/50 leading-tight" role="status">
          {statusLabel ||
            (pageCount === 1
              ? "1 page"
              : pageCount
                ? `${pageCount} pages`
                : "PDF")}
        </p>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel || `Remove ${name || "PDF"}`}
          className="shrink-0 min-w-11 min-h-11 flex items-center justify-center text-primary/50 hover:text-primary"
        >
          <X className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  );
}
