import { useEffect, useMemo, useState } from "react";
import { X, Search, Check, Loader, Users } from "lucide-react";
import {
  searchStarterSeries,
  getStarterSeriesById,
  upsertCharacters,
} from "@/lib/seedCharacters";

export default function AddSeriesCharactersModal({ open, existingIds, onClose, onAdded }) {
  const [query, setQuery] = useState("");
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [resultMsg, setResultMsg] = useState(null);

  const matches = useMemo(() => searchStarterSeries(query), [query]);
  const activeSeries = activeSeriesId ? getStarterSeriesById(activeSeriesId) : null;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveSeriesId(null);
    setSelected(new Set());
    setError(null);
    setResultMsg(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (matches.length === 1 && query.trim()) {
      setActiveSeriesId(matches[0].id);
    }
  }, [matches, query, open]);

  useEffect(() => {
    if (!activeSeries) {
      setSelected(new Set());
      return;
    }
    const available = activeSeries.characters
      .filter((c) => !existingIds.has(c.id))
      .map((c) => c.id);
    setSelected(new Set(available));
  }, [activeSeries, existingIds]);

  if (!open) return null;

  const toggleChar = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllAvailable = () => {
    if (!activeSeries) return;
    const ids = activeSeries.characters
      .filter((c) => !existingIds.has(c.id))
      .map((c) => c.id);
    setSelected(new Set(ids));
  };

  const clearSelection = () => setSelected(new Set());

  const handleAdd = async () => {
    if (!activeSeries || selected.size === 0) return;
    setAdding(true);
    setError(null);
    setResultMsg(null);
    try {
      const picked = activeSeries.characters.filter((c) => selected.has(c.id));
      const { added, skipped } = await upsertCharacters(picked);
      if (added === 0 && skipped > 0) {
        setResultMsg("Those characters are already in your library.");
      } else {
        setResultMsg(
          `Added ${added} character${added === 1 ? "" : "s"}` +
            (skipped ? ` (${skipped} already in library)` : "") +
            ".",
        );
        onAdded?.();
      }
    } catch (err) {
      setError(err?.message || "Could not add characters.");
    } finally {
      setAdding(false);
    }
  };

  const availableCount =
    activeSeries?.characters.filter((c) => !existingIds.has(c.id)).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-background border border-primary/30 hud-corner glow-border max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-primary/20">
          <div>
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm">
              // Add From Series
            </h2>
            <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest uppercase">
              Type a series name, pick characters, add to your library
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 border-b border-primary/15 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveSeriesId(null);
                setError(null);
                setResultMsg(null);
              }}
              placeholder="e.g. Korra, Marvel, Guardians, Invincible..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-3 focus:outline-none focus:border-primary/50 transition-colors"
              autoFocus
            />
          </div>

          {query.trim() && !activeSeries && (
            <div className="space-y-2">
              {matches.length === 0 ? (
                <p className="text-[10px] font-mono text-primary/30 tracking-wider">
                  No series matched. Try Korra, Marvel, Guardians, or Invincible.
                </p>
              ) : (
                matches.map((series) => (
                  <button
                    key={series.id}
                    type="button"
                    onClick={() => {
                      setActiveSeriesId(series.id);
                      setError(null);
                      setResultMsg(null);
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 border border-primary/15 bg-black/40 hover:border-primary/40 hover:bg-primary/5 text-left transition-all"
                  >
                    <div>
                      <p className="font-mono text-xs text-primary tracking-wider uppercase">
                        {series.name}
                      </p>
                      <p className="text-[9px] font-mono text-primary/30 mt-0.5">
                        {series.characters.length} characters
                      </p>
                    </div>
                    <Users className="w-4 h-4 text-primary/40 flex-shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}

          {activeSeries && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="font-mono text-[10px] text-primary/50 tracking-widest uppercase">
                {activeSeries.name}
                <button
                  type="button"
                  onClick={() => setActiveSeriesId(null)}
                  className="ml-3 text-primary/30 hover:text-primary underline-offset-2 hover:underline normal-case"
                >
                  change series
                </button>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllAvailable}
                  disabled={availableCount === 0}
                  className="px-3 py-1 border border-primary/20 text-primary/50 hover:text-primary font-mono text-[9px] tracking-widest uppercase disabled:opacity-30"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="px-3 py-1 border border-primary/20 text-primary/50 hover:text-primary font-mono text-[9px] tracking-widest uppercase"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!activeSeries && !query.trim() && (
            <p className="text-center font-mono text-primary/20 text-xs tracking-[0.25em] uppercase py-12">
              Search for a series to browse its characters
            </p>
          )}

          {activeSeries && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {activeSeries.characters.map((char) => {
                const owned = existingIds.has(char.id);
                const checked = selected.has(char.id);
                return (
                  <button
                    key={char.id}
                    type="button"
                    disabled={owned}
                    onClick={() => !owned && toggleChar(char.id)}
                    className={`flex items-center gap-3 p-3 border text-left transition-all ${
                      owned
                        ? "border-primary/10 bg-black/20 opacity-50 cursor-not-allowed"
                        : checked
                          ? "border-primary/50 bg-primary/10"
                          : "border-primary/15 bg-black/40 hover:border-primary/30"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 border flex items-center justify-center flex-shrink-0 ${
                        owned
                          ? "border-primary/20"
                          : checked
                            ? "border-primary bg-primary/20"
                            : "border-primary/30"
                      }`}
                    >
                      {(checked || owned) && (
                        <Check className={`w-3 h-3 ${owned ? "text-primary/30" : "text-primary"}`} />
                      )}
                    </div>
                    {char.avatar_url ? (
                      <img
                        src={char.avatar_url}
                        alt=""
                        className="w-12 h-12 object-cover border border-primary/20 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-primary/5 border border-primary/20 flex items-center justify-center font-mono text-primary/30 flex-shrink-0">
                        {char.name[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs text-primary truncate uppercase tracking-wide">
                        {char.name}
                      </p>
                      <p className="text-[9px] font-mono text-primary/30 capitalize">
                        {char.category}
                        {owned ? " · in library" : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-primary/20 space-y-2">
          {error && (
            <p className="text-[10px] font-mono text-destructive/80">{error}</p>
          )}
          {resultMsg && (
            <p className="text-[10px] font-mono text-green-400/80">{resultMsg}</p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary font-mono text-xs tracking-widest uppercase"
            >
              {resultMsg ? "Done" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!activeSeries || selected.size === 0 || adding}
              className="px-6 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase hud-corner flex items-center gap-2"
            >
              {adding ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Adding...
                </>
              ) : (
                `Add ${selected.size} Character${selected.size === 1 ? "" : "s"}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
