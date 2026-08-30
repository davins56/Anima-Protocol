import { useEffect, useMemo, useState } from "react";
import {
  ECHO_KEYS,
  ECHO_FAMILIES,
  BATTLE_CHIP_LINEAGE,
  STAR_FORCE_CARD_LINEAGE,
  ECHO_KEY_SYSTEM,
  ECHO_FOLDER_RULES,
  ECHO_KEY_BY_ID,
  makeEchoCopy,
  validateEchoFolder,
  echoFolderStats,
} from "@/lib/echoKeys";
import { ECHO_CLASS_THEME, ECHO_ELEMENT_THEME } from "@/lib/echoKeys/theme";
import EchoKeyCard from "./EchoKeyCard";

const ELEMENTS = ["all", "void", "ember", "tide", "volt", "grove"];
const CLASSES = ["all", "standard", "mega", "star", "dark", "giga"];

export default function EchoKeyVault({ library, onSave, saving, error, onReset, ownedOnly = false }) {
  const [tab, setTab] = useState("library");
  const [element, setElement] = useState("all");
  const [klass, setKlass] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(ECHO_KEYS[0].id);
  const [draft, setDraft] = useState(() => library.folder.map((s) => ({ ...s })));
  const [regularId, setRegularId] = useState(library.regular_id);
  const [starCardId, setStarCardId] = useState(library.star_card_id);

  useEffect(() => {
    setDraft(library.folder.map((s) => ({ ...s })));
    setRegularId(library.regular_id);
    setStarCardId(library.star_card_id);
  }, [library]);

  const selected = ECHO_KEY_BY_ID[selectedId] || ECHO_KEYS[0];
  const owned = new Set(library.owned_ids);
  const check = validateEchoFolder(draft);
  const stats = echoFolderStats({ folder: draft });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ECHO_KEYS.filter((k) => {
      if (ownedOnly && !owned.has(k.id)) return false;
      if (element !== "all" && k.element !== element) return false;
      if (klass !== "all" && k.class !== klass) return false;
      if (!q) return true;
      return (
        k.name.toLowerCase().includes(q) ||
        k.family.includes(q) ||
        k.memory.toLowerCase().includes(q) ||
        k.inspiredBy.includes(q) ||
        k.ability?.tag?.includes(q)
      );
    });
  }, [element, klass, query, ownedOnly, owned]);

  const addToFolder = (key) => {
    if (!owned.has(key.id)) return;
    if (draft.length >= ECHO_FOLDER_RULES.size) return;
    setDraft((prev) => [...prev, makeEchoCopy(key.id)]);
    setTab("folder");
  };

  const removeAt = (index) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const cycleCode = (index) => {
    setDraft((prev) => {
      const next = prev.map((s) => ({ ...s }));
      const slot = next[index];
      const key = ECHO_KEY_BY_ID[slot.id];
      if (!key) return prev;
      const at = key.codes.indexOf(slot.code);
      slot.code = key.codes[(at + 1) % key.codes.length];
      return next;
    });
  };

  const handleSave = () => {
    onSave({
      ...library,
      folder: draft,
      regular_id: regularId,
      star_card_id: starCardId,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {[
          ["library", "Echo Library"],
          ["folder", "Folder"],
          ["account", "Chip / Card Account"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="px-3 py-1.5 border font-mono text-[8px] tracking-[0.22em] uppercase transition-all"
            style={{
              borderColor: tab === id ? "rgba(253,230,138,0.45)" : "rgba(255,255,255,0.08)",
              background: tab === id ? "rgba(253,230,138,0.1)" : "transparent",
              color: tab === id ? "#fde68a" : "rgba(255,255,255,0.35)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "account" ? (
        <AccountPanel />
      ) : tab === "folder" ? (
        <div className="space-y-4">
          <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-primary/35">
            {draft.length}/{ECHO_FOLDER_RULES.size} slotted · {stats.standard_count} std · {stats.mega_count} mega · {stats.star_count} star
          </p>
          {!check.ok && (
            <ul className="font-mono text-[10px] text-rose-300/80 space-y-1">
              {check.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
          <div className="grid sm:grid-cols-2 gap-2">
            {draft.map((slot, index) => {
              const key = ECHO_KEY_BY_ID[slot.id];
              if (!key) return null;
              return (
                <div key={`${slot.id}-${index}`} className="relative">
                  <EchoKeyCard
                    echoKey={key}
                    code={slot.code}
                    compact
                    selected={key.id === selectedId}
                    onClick={() => setSelectedId(key.id)}
                  />
                  <div className="absolute top-1 right-1 flex gap-1">
                    <button
                      type="button"
                      onClick={() => cycleCode(index)}
                      className="px-1.5 py-0.5 font-mono text-[8px] uppercase border border-white/15 text-primary/60 hover:text-primary"
                    >
                      Code
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAt(index)}
                      className="px-1.5 py-0.5 font-mono text-[8px] uppercase border border-rose-400/30 text-rose-300/70 hover:text-rose-200"
                    >
                      Out
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block font-mono text-[9px] tracking-[0.2em] uppercase text-primary/40">
              Regular key (always in opening hand)
              <select
                value={regularId || ""}
                onChange={(e) => setRegularId(e.target.value)}
                className="mt-1 w-full bg-black/40 border border-primary/20 px-2 py-2 text-[11px] text-primary/80"
              >
                {draft.map((slot, i) => (
                  <option key={`${slot.id}-${i}`} value={slot.id}>
                    {ECHO_KEY_BY_ID[slot.id]?.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block font-mono text-[9px] tracking-[0.2em] uppercase text-primary/40">
              Star-Force pin (lock-on card)
              <select
                value={starCardId || ""}
                onChange={(e) => setStarCardId(e.target.value)}
                className="mt-1 w-full bg-black/40 border border-primary/20 px-2 py-2 text-[11px] text-primary/80"
              >
                {ECHO_KEYS.filter((k) => k.class === "star").map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !check.ok}
              onClick={handleSave}
              className="px-4 py-2 border border-amber-300/40 bg-amber-950/30 font-mono text-[9px] tracking-[0.22em] uppercase text-amber-100 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save folder to profile"}
            </button>
            <button
              type="button"
              onClick={onReset}
              className="px-4 py-2 border border-white/10 font-mono text-[9px] tracking-[0.22em] uppercase text-primary/50 hover:text-primary"
            >
              Reset starter
            </button>
          </div>
          {error && <p className="font-mono text-[10px] text-rose-300/80">{error}</p>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search echo keys…"
              className="flex-1 min-w-[160px] bg-black/40 border border-primary/20 px-3 py-2 font-mono text-[11px] text-primary/80 outline-none focus:border-primary/50"
            />
            {CLASSES.map((c) => (
              <FilterChip
                key={c}
                active={klass === c}
                onClick={() => setKlass(c)}
                label={c === "all" ? "All class" : ECHO_CLASS_THEME[c].label}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {ELEMENTS.map((el) => (
              <FilterChip
                key={el}
                active={element === el}
                onClick={() => setElement(el)}
                label={el === "all" ? "All elements" : ECHO_ELEMENT_THEME[el].label}
                color={el === "all" ? undefined : ECHO_ELEMENT_THEME[el].color}
              />
            ))}
          </div>
          <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-primary/35">
            {filtered.length} keys · {owned.size} on this profile · weapons summon as remembered constructs
          </p>
          <div className="grid lg:grid-cols-[1fr_minmax(260px,320px)] gap-4">
            <div className="grid sm:grid-cols-2 gap-2 max-h-[62vh] overflow-y-auto pr-1">
              {filtered.map((k) => (
                <EchoKeyCard
                  key={k.id}
                  echoKey={k}
                  compact
                  owned={owned.has(k.id)}
                  selected={k.id === selectedId}
                  onClick={() => setSelectedId(k.id)}
                />
              ))}
            </div>
            <div className="border border-amber-300/20 bg-black/40 p-4 sticky top-2 h-fit">
              <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-amber-200/50">
                Weapon memory
              </p>
              <h2 className="mt-2 font-mono text-lg text-amber-100">{selected.name}</h2>
              <p className="mt-2 text-[12px] text-primary/70 leading-relaxed">{selected.memory}</p>
              <p className="mt-2 text-[11px] text-primary/50 leading-relaxed">{selected.description}</p>
              <p className="mt-3 font-mono text-[8px] tracking-[0.2em] uppercase text-primary/35">
                Inspired by {selected.inspiredBy} · {selected.sources.join(" · ")}
              </p>
              <button
                type="button"
                onClick={() => addToFolder(selected)}
                disabled={draft.length >= ECHO_FOLDER_RULES.size}
                className="mt-4 w-full px-3 py-2 border border-amber-300/35 font-mono text-[9px] tracking-[0.2em] uppercase text-amber-100 disabled:opacity-40"
              >
                Slot into folder
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 border font-mono text-[8px] tracking-[0.18em] uppercase"
      style={{
        borderColor: active ? color || "rgba(253,230,138,0.45)" : "rgba(255,255,255,0.08)",
        color: active ? color || "#fde68a" : "rgba(255,255,255,0.35)",
        background: active ? "rgba(253,230,138,0.08)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

function AccountPanel() {
  return (
    <div className="space-y-5 text-[13px] text-primary/70 leading-relaxed">
      <section>
        <h3 className="font-mono text-[9px] tracking-[0.25em] uppercase text-amber-200/60 mb-2">
          Echo Keys
        </h3>
        <p>{ECHO_KEY_SYSTEM.summary}</p>
      </section>
      <section>
        <h3 className="font-mono text-[9px] tracking-[0.25em] uppercase text-amber-200/60 mb-2">
          Battle Chip lineage
        </h3>
        <p>{BATTLE_CHIP_LINEAGE.summary}</p>
        <p className="mt-2 text-primary/50">{BATTLE_CHIP_LINEAGE.versions}</p>
      </section>
      <section>
        <h3 className="font-mono text-[9px] tracking-[0.25em] uppercase text-amber-200/60 mb-2">
          Star Force cards
        </h3>
        <p>{STAR_FORCE_CARD_LINEAGE.summary}</p>
        <p className="mt-2 text-primary/50">{STAR_FORCE_CARD_LINEAGE.satellites}</p>
      </section>
      <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-primary/35">
        {ECHO_FAMILIES.length} families · 10 memories each · {ECHO_KEYS.length} keys
      </p>
    </div>
  );
}
