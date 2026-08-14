import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FRAGMENT_BY_ID, drawHand, findResonance, rankHand, selectionIsLinked, starterFolder } from "@/lib/energyFragments";
import FragmentCard from "./FragmentCard";
import EtherealSummon from "./EtherealSummon";

/**
 * Battle Network-style Custom window: draw 5 from the starter Folder,
 * slot copies that share a name or code, summon the ethereal weapon, then commit.
 */
export default function CustomWindow({ findings = [], onCommit, onSkip }) {
  const folder = useMemo(() => starterFolder(), []);
  const hand = useMemo(() => drawHand(folder, 5), [folder]);
  const [picked, setPicked] = useState([]);
  const [summoning, setSummoning] = useState(false);

  const selectedFrags = picked.map((s) => FRAGMENT_BY_ID[s.id]).filter(Boolean);
  const ranked = rankHand(
    hand.map((s) => FRAGMENT_BY_ID[s.id]).filter(Boolean),
    findings,
  );
  const recommendedIds = new Set(ranked.filter((r) => r.recommended || r.multiplier > 1).map((r) => r.fragment.id));
  const combo = findResonance(selectedFrags.map((f) => f.id));
  const stageFrag = selectedFrags[selectedFrags.length - 1] || ranked[0]?.fragment || FRAGMENT_BY_ID[hand[0]?.id];

  const toggle = (slot, index) => {
    const next = picked.some((p) => p._i === index)
      ? picked.filter((p) => p._i !== index)
      : [...picked, { ...slot, _i: index }];
    if (!selectionIsLinked(next)) return;
    setPicked(next);
  };

  const commit = () => {
    if (!picked.length) return;
    setSummoning(true);
    window.setTimeout(() => {
      onCommit?.({
        slots: picked,
        fragments: selectedFrags,
        combo,
      });
    }, 1100);
  };

  return (
    <div className="border-t border-primary/15 bg-black/50">
      <div className="px-5 pt-3 pb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-[0.28em] uppercase text-cyan-300/80">
          // Custom Window — Energy Fragments
        </p>
        <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">
          Same name or code to link
        </p>
      </div>
      <div className="px-5 pb-3 grid grid-cols-1 sm:grid-cols-5 gap-2">
        {hand.map((slot, i) => {
          const frag = FRAGMENT_BY_ID[slot.id];
          if (!frag) return null;
          const selected = picked.some((p) => p._i === i);
          return (
            <FragmentCard
              key={`${slot.id}-${i}`}
              fragment={frag}
              code={slot.code}
              compact
              selected={selected}
              recommended={recommendedIds.has(frag.id)}
              onClick={() => toggle(slot, i)}
            />
          );
        })}
      </div>
      <AnimatePresence>
        {(picked.length > 0 || summoning) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <EtherealSummon fragment={stageFrag} combo={combo} compact />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex border-t border-primary/15">
        <button
          type="button"
          onClick={onSkip}
          className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-primary/50 hover:text-primary/80 hover:bg-primary/5"
        >
          Skip Slot
        </button>
        <button
          type="button"
          disabled={!picked.length || summoning}
          onClick={commit}
          className="flex-1 py-3 font-mono text-[10px] tracking-[0.2em] uppercase border-l border-primary/15 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {summoning ? "Summoning…" : combo ? `Resonate ${combo.name}` : "Slot & Summon"}
        </button>
      </div>
    </div>
  );
}
