import FragmentCard from "@/components/energyFragments/FragmentCard";

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
  return (
    <div className="relative">
      <FragmentCard
        fragment={echoKey}
        code={code}
        selected={selected}
        compact={compact}
        onClick={onClick}
      />
      <span className="absolute bottom-1.5 right-2 font-mono text-[7px] tracking-[0.18em] uppercase text-primary/35">
        {MEMORY_LABEL[echoKey.memory] || echoKey.memory}
      </span>
    </div>
  );
}
