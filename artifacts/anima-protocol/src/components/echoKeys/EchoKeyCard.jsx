import FragmentCard from "@/components/energyFragments/FragmentCard";
import { enrichEchoKey } from "@/lib/echoKeys";

const MEMORY_LABEL = {
  weapon: "Weapon",
  plus: "Plus",
  field: "Field",
  dark: "Dark",
  wave: "Wave",
  brother: "Brother",
  nova: "Nova",
};

export default function EchoKeyCard({ echoKey, code = null, selected = false, onClick, compact = false }) {
  const enriched = enrichEchoKey(echoKey) || echoKey;
  return (
    <div className="relative">
      <FragmentCard
        fragment={echoKey}
        code={code}
        selected={selected}
        compact={compact}
        onClick={onClick}
      />
      <span className="absolute top-1.5 left-2 font-mono text-[7px] tracking-[0.16em] uppercase text-cyan-200/50">
        {enriched.tier || "shard"}
      </span>
      <span className="absolute bottom-1.5 right-2 font-mono text-[7px] tracking-[0.18em] uppercase text-primary/35">
        {MEMORY_LABEL[echoKey.memory] || echoKey.memory}
      </span>
    </div>
  );
}
