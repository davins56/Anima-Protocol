import { useMemo, useState } from "react";
import EchoKeyCard from "./EchoKeyCard";
import { ECHO_KEY_BY_ID, validateEchoFolder } from "@/lib/echoKeys";

export default function EchoFolderEditor({ folder, ownedKeys, onChange }) {
  const [query, setQuery] = useState("");
  const slots = folder?.slots || [];
  const check = validateEchoFolder(slots);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ownedKeys.filter((k) => {
      if (!q) return true;
      return (
        k.name.toLowerCase().includes(q) ||
        k.family.includes(q) ||
        k.memory.includes(q) ||
        k.description.toLowerCase().includes(q)
      );
    });
  }, [ownedKeys, query]);

  const addKey = (key) => {
    if (slots.length >= 30) return;
    const next = [...slots, { id: key.id, code: key.codes[0] }];
    onChange(next);
  };

  const removeAt = (index) => {
    onChange(slots.filter((_, i) => i !== index));
  };

  const cycleCode = (index) => {
    const slot = slots[index];
    const key = ECHO_KEY_BY_ID[slot.id];
    if (!key) return;
    const i = key.codes.indexOf(slot.code);
    const code = key.codes[(i + 1) % key.codes.length];
    onChange(slots.map((s, n) => (n === index ? { ...s, code } : s)));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-primary/60">
            Resonance Array · {slots.length}/30
          </p>
          <p className={`font-mono text-[9px] tracking-widest uppercase ${check.ok ? "text-emerald-300/80" : "text-rose-300/80"}`}>
            {check.ok ? "Legal" : check.errors[0] || "Need 8–30 keys"}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[520px] overflow-y-auto pr-1">
          {slots.map((slot, i) => {
            const key = ECHO_KEY_BY_ID[slot.id];
            if (!key) return null;
            return (
              <div key={`${slot.id}-${i}`} className="relative">
                <EchoKeyCard
                  echoKey={key}
                  code={slot.code}
                  compact
                  onClick={() => cycleCode(i)}
                />
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="absolute top-1 right-1 w-5 h-5 border border-primary/30 bg-black/80 text-primary/70 font-mono text-[10px]"
                  aria-label={`Remove ${key.name}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search owned Echo Keys…"
          className="w-full mb-3 bg-black/50 border border-primary/20 px-3 py-2 font-mono text-xs text-primary placeholder:text-primary/30"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[520px] overflow-y-auto pr-1">
          {filtered.slice(0, 120).map((key) => (
            <EchoKeyCard
              key={key.id}
              echoKey={key}
              compact
              onClick={() => addKey(key)}
            />
          ))}
        </div>
        <p className="mt-2 font-mono text-[8px] text-primary/30 tracking-widest uppercase">
          Click a Vault key to load · click an Array key to cycle its code · 8–30 slots
        </p>
      </div>
    </div>
  );
}
