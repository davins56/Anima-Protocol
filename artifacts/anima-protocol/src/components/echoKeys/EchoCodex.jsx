import { useMemo, useState } from "react";
import {
  ECHO_KEYS,
  ECHO_TIERS,
  TIER_BLURB,
  TIER_LABEL,
  enrichEchoKey,
  getResonanceSite,
} from "@/lib/echoKeys";

const TIER_FILTERS = ["all", ...ECHO_TIERS];

export default function EchoCodex({ ownedIds }) {
  const owned = useMemo(() => new Set(ownedIds), [ownedIds]);
  const [tier, setTier] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (k) => (k.sources?.includes("canon") ? 0 : k.family === "featured" ? 1 : 2);
    return ECHO_KEYS.map((k) => enrichEchoKey(k))
      .filter((k) => {
        if (tier !== "all" && k.tier !== tier) return false;
        if (!q) return true;
        return (
          k.name.toLowerCase().includes(q) ||
          k.family.includes(q) ||
          k.frequency.includes(q) ||
          k.role.includes(q) ||
          k.description.toLowerCase().includes(q) ||
          k.memory.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => rank(a) - rank(b) || a.libraryNo - b.libraryNo);
  }, [tier, query]);

  const selected = rows.find((k) => k.id === selectedId) || null;
  const site = selected ? getResonanceSite(selected.originSite) : null;
  const known = selected ? owned.has(selected.id) : false;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-primary/65 leading-relaxed max-w-3xl">
        The Codex lists every named artifact. Locked entries show only a silhouette and a site
        hint — not the whole enchilada. Sovereign and Prime Keys keep the novels&apos; gravity;
        they are not shop inventory.
      </p>
      <div className="flex flex-wrap gap-2">
        {TIER_FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTier(id)}
            className="px-2 py-1 border font-mono text-[8px] tracking-[0.18em] uppercase"
            style={{
              borderColor: tier === id ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.08)",
              color: tier === id ? "#67e8f9" : "rgba(255,255,255,0.35)",
            }}
          >
            {id === "all" ? "all tiers" : TIER_LABEL[id]}
          </button>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the Codex…"
        className="w-full bg-black/50 border border-primary/20 px-3 py-2 font-mono text-xs text-primary placeholder:text-primary/30"
      />
      <p className="font-mono text-[9px] text-primary/35 tracking-widest uppercase">
        {rows.filter((k) => owned.has(k.id)).length} known · {rows.length} listed
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-1.5">
        {rows.slice(0, tier === "all" && !query.trim() ? 240 : rows.length).map((key) => {
          const have = owned.has(key.id);
          return (
            <button
              key={key.id}
              type="button"
              onClick={() => setSelectedId(key.id)}
              className="aspect-[3/4] border px-1 py-2 flex flex-col items-center justify-center gap-1"
              style={{
                borderColor:
                  selectedId === key.id
                    ? "rgba(34,211,238,0.5)"
                    : have
                      ? "rgba(34,211,238,0.2)"
                      : "rgba(255,255,255,0.06)",
                background: have ? "rgba(34,211,238,0.06)" : "rgba(0,0,0,0.45)",
                opacity: have ? 1 : 0.55,
              }}
              aria-label={have ? key.name : `Unknown ${key.tier}`}
            >
              <span className="font-mono text-[8px] text-primary/40">
                {String(key.libraryNo).padStart(3, "0")}
              </span>
              <span className="font-mono text-[9px] text-center leading-tight text-primary/80">
                {have ? key.name : "····"}
              </span>
              <span className="font-mono text-[7px] tracking-widest uppercase text-primary/30">
                {key.tier}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="border border-primary/20 bg-black/40 p-4 space-y-2">
          <p className="font-mono text-sm text-primary">{known ? selected.name : "Unattuned Echo"}</p>
          <p className="font-mono text-[9px] tracking-widest uppercase text-primary/40">
            {TIER_LABEL[selected.tier]} · {selected.codes.join(" ")} · {selected.mb} MB · {selected.element} · {selected.frequency} · {selected.role}
          </p>
          <p className="text-[12px] text-primary/60 leading-relaxed">
            {known
              ? selected.description
              : site
                ? `Hint: ${site.hint} (${site.name})`
                : TIER_BLURB[selected.tier]}
          </p>
          {known && (
            <p className="text-[11px] text-primary/45 leading-relaxed">{selected.memoryText}</p>
          )}
          {!known && <p className="font-mono text-[10px] text-primary/40">{TIER_BLURB[selected.tier]}</p>}
        </div>
      )}
    </div>
  );
}
