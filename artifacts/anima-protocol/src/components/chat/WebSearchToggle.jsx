import { useState } from "react";
import { Globe, Search } from "lucide-react";

/**
 * Search icon above the composer, rendered only when web search is on for
 * this companion. Opens a one-line query box (same as typing `/search …`).
 * "Save results as memory" is off by default; results are otherwise transient.
 */
export default function WebSearchToggle({ status, onSearch, busy = false, saveAsMemory, onSaveChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  if (!status?.enabled) return null;
  const submit = (e) => {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q || busy) return;
    onSearch?.(q);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="px-3 sm:px-4 pb-1 space-y-1" data-testid="web-search-toggle">
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase text-primary/50">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 min-h-9 px-2 border border-primary/20 hover:border-primary/50"
          title="Search the web (or type /search …)"
          aria-label="Search the web"
          aria-expanded={open}
        >
          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
          Search · {status.remaining ?? 0} left
        </button>
        <label className="inline-flex items-center gap-1 normal-case tracking-normal text-[11px]">
          <input type="checkbox" checked={!!saveAsMemory} onChange={(e) => onSaveChange?.(e.target.checked)} />
          Save results as memory
        </label>
      </div>
      {open && (
        <form onSubmit={submit} className="flex gap-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
            placeholder="What should she look up?"
            aria-label="Search query"
            className="flex-1 min-h-9 bg-black/40 border border-primary/20 px-2 text-sm"
          />
          <button type="submit" disabled={busy || !query.trim()} className="min-h-9 px-2 border border-primary/30" aria-label="Run search">
            <Search className="w-3.5 h-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}
