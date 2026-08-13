import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BN1_CHIP_FAMILIES,
  LATER_CHIP_FAMILIES,
  BATTLE_CHIP_SYSTEM,
  CHIP_CLASSES,
  ENERGY_FRAGMENTS,
  FAMILY_TO_FRAGMENT,
  fragmentsByFamily,
} from "@/lib/energyFragments";
import { CLASS_THEME, ELEMENT_THEME, TACTIC_LABEL, elementTheme } from "@/lib/energyFragments/theme";
import FragmentCard from "./FragmentCard";
import EtherealSummon from "./EtherealSummon";

const ELEMENTS = ["all", "void", "ember", "tide", "volt", "grove"];
const CLASSES = ["all", "standard", "apex", "nova"];

export default function FragmentLibrary() {
  const [tab, setTab] = useState("library");
  const [element, setElement] = useState("all");
  const [klass, setKlass] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(ENERGY_FRAGMENTS[0].id);
  const [summoned, setSummoned] = useState(false);

  const selected = ENERGY_FRAGMENTS.find((f) => f.id === selectedId) || ENERGY_FRAGMENTS[0];
  const familySiblings = fragmentsByFamily(selected.family);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ENERGY_FRAGMENTS.filter((f) => {
      if (element !== "all" && f.element !== element) return false;
      if (klass !== "all" && f.class !== klass) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.family.includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.inspiredByFamily.includes(q)
      );
    });
  }, [element, klass, query]);

  const sourceFamily = [...BN1_CHIP_FAMILIES, ...LATER_CHIP_FAMILIES].find(
    (f) => FAMILY_TO_FRAGMENT[f.id] === selected.family || f.id === selected.inspiredByFamily,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {[
          ["library", "Fragment Library"],
          ["account", "Chip Account"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="px-3 py-1.5 border font-mono text-[8px] tracking-[0.22em] uppercase transition-all"
            style={{
              borderColor: tab === id ? "rgba(34,211,238,0.45)" : "rgba(255,255,255,0.08)",
              background: tab === id ? "rgba(34,211,238,0.1)" : "transparent",
              color: tab === id ? "#67e8f9" : "rgba(255,255,255,0.35)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "account" ? (
        <AccountPanel />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fragments…"
              className="flex-1 min-w-[160px] bg-black/40 border border-primary/20 px-3 py-2 font-mono text-[11px] text-primary/80 outline-none focus:border-primary/50"
            />
            {CLASSES.map((c) => (
              <FilterChip key={c} active={klass === c} onClick={() => setKlass(c)} label={c === "all" ? "All class" : CLASS_THEME[c].label} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {ELEMENTS.map((el) => (
              <FilterChip
                key={el}
                active={element === el}
                onClick={() => setElement(el)}
                label={el === "all" ? "All elements" : ELEMENT_THEME[el].label}
                color={el === "all" ? undefined : ELEMENT_THEME[el].color}
              />
            ))}
          </div>

          <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-primary/35">
            {filtered.length} fragments · weapons summon as ethereal constructs
          </p>

          <div className="grid lg:grid-cols-[1fr_minmax(260px,320px)] gap-4">
            <div className="grid sm:grid-cols-2 gap-2 max-h-[62vh] overflow-y-auto pr-1">
              {filtered.map((f) => (
                <FragmentCard
                  key={f.id}
                  fragment={f}
                  compact
                  selected={f.id === selectedId}
                  onClick={() => {
                    setSelectedId(f.id);
                    setSummoned(false);
                  }}
                />
              ))}
            </div>

            <div className="border border-primary/20 bg-black/40 p-4 sticky top-2 h-fit">
              <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40">
                {String(selected.libraryNo).padStart(3, "0")} · {selected.family}
              </p>
              <h2 className="mt-1 font-mono text-lg text-primary">{selected.name}</h2>
              <p className="mt-2 text-[12px] text-primary/70 leading-relaxed">{selected.description}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-primary/50">
                <dt>Element</dt>
                <dd style={{ color: elementTheme(selected.element).color }}>{ELEMENT_THEME[selected.element].label}</dd>
                <dt>Tactic</dt>
                <dd>{TACTIC_LABEL[selected.tactic]}</dd>
                <dt>Power</dt>
                <dd>{selected.power == null ? "—" : selected.power}</dd>
                <dt>MB</dt>
                <dd>{selected.mb}</dd>
                <dt>Codes</dt>
                <dd>{selected.codes.join(" ")}</dd>
                <dt>Class</dt>
                <dd style={{ color: CLASS_THEME[selected.class].color }}>{CLASS_THEME[selected.class].label}</dd>
              </dl>
              {sourceFamily && (
                <p className="mt-3 font-mono text-[9px] text-primary/40 leading-relaxed">
                  Variation of the {sourceFamily.label} chip family — {sourceFamily.mechanic}
                </p>
              )}
              {familySiblings.length > 1 && (
                <p className="mt-2 font-mono text-[9px] text-primary/35">
                  Family: {familySiblings.map((s) => s.name).join(" · ")}
                </p>
              )}
              <button
                type="button"
                onClick={() => setSummoned(true)}
                className="mt-4 w-full py-2.5 border border-cyan-400/40 font-mono text-[10px] tracking-[0.28em] uppercase text-cyan-200 hover:bg-cyan-400/10 transition-all"
              >
                Summon Weapon
              </button>
              <AnimatePresence>
                {summoned && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-3 border border-primary/15 bg-black/50"
                  >
                    <EtherealSummon fragment={selected} compact />
                  </motion.div>
                )}
              </AnimatePresence>
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
      className="px-2.5 py-1 border font-mono text-[8px] tracking-[0.2em] uppercase transition-all"
      style={{
        borderColor: active ? color || "rgba(34,211,238,0.45)" : "rgba(255,255,255,0.08)",
        color: active ? color || "#67e8f9" : "rgba(255,255,255,0.35)",
        background: active ? "rgba(34,211,238,0.08)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

function AccountPanel() {
  return (
    <div className="space-y-5">
      <div className="border border-primary/20 bg-black/40 p-4">
        <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-cyan-300/80">Research ledger</p>
        <h2 className="mt-1 font-mono text-sm text-primary">{BATTLE_CHIP_SYSTEM.title}</h2>
        <p className="mt-2 text-[12px] text-primary/70 leading-relaxed">{BATTLE_CHIP_SYSTEM.summary}</p>
        <p className="mt-2 text-[12px] text-primary/55 leading-relaxed">{BATTLE_CHIP_SYSTEM.battlefield}</p>
        <p className="mt-2 text-[12px] text-primary/55 leading-relaxed">{BATTLE_CHIP_SYSTEM.buster}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {CHIP_CLASSES.map((c) => (
          <div key={c.id} className="border border-primary/15 bg-black/30 p-3">
            <p className="font-mono text-[10px] tracking-widest uppercase text-cyan-300/80">{c.label}</p>
            <p className="mt-1 font-mono text-[10px] text-primary/45">{c.folderCap}</p>
            <p className="mt-1 text-[11px] text-primary/60">{c.note}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-2 font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40">
          BN1 families accounted ({BN1_CHIP_FAMILIES.length})
        </p>
        <div className="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
          {BN1_CHIP_FAMILIES.map((fam) => (
            <div key={fam.id} className="border border-primary/10 bg-black/25 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-mono text-[12px] text-primary/85">{fam.label}</p>
                <p className="font-mono text-[9px] text-cyan-300/60 uppercase tracking-widest">
                  → {FAMILY_TO_FRAGMENT[fam.id]}
                </p>
              </div>
              <p className="mt-1 font-mono text-[10px] text-primary/40">{fam.members.join(" · ")}</p>
              <p className="mt-1 text-[11px] text-primary/60 leading-relaxed">{fam.mechanic}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40">Later titles</p>
        <div className="space-y-2">
          {LATER_CHIP_FAMILIES.map((fam) => (
            <div key={fam.id} className="border border-primary/10 bg-black/25 p-3">
              <p className="font-mono text-[12px] text-primary/85">{fam.label}</p>
              <p className="mt-1 font-mono text-[10px] text-primary/40">{fam.members.join(" · ")}</p>
              <p className="mt-1 text-[11px] text-primary/60">{fam.mechanic}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
