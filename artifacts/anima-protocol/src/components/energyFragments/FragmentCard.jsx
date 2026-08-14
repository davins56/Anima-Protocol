import { elementTheme, CLASS_THEME, TACTIC_LABEL } from "@/lib/energyFragments/theme";

export default function FragmentCard({
  fragment,
  code = null,
  selected = false,
  recommended = false,
  compact = false,
  onClick,
}) {
  const theme = elementTheme(fragment.element);
  const klass = CLASS_THEME[fragment.class] || CLASS_THEME.standard;
  const shownCode = code || fragment.codes[0];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left border transition-all ${
        compact ? "p-2" : "p-3"
      } ${selected ? "ring-1" : "hover:bg-white/[0.03]"}`}
      style={{
        borderColor: selected ? theme.color : recommended ? `${theme.color}66` : "rgba(34,211,238,0.18)",
        boxShadow: selected ? `0 0 18px ${theme.glow}` : recommended ? `0 0 10px ${theme.glow}` : "none",
        background: selected ? theme.fill : "rgba(0,0,0,0.35)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="font-mono text-[9px] tracking-[0.22em] uppercase"
          style={{ color: klass.color }}
        >
          {String(fragment.libraryNo).padStart(3, "0")} · {klass.label}
        </span>
        <span
          className="font-mono text-sm font-bold leading-none"
          style={{ color: theme.color }}
        >
          {shownCode}
        </span>
      </div>
      <p className={`font-mono text-primary/90 ${compact ? "text-[11px] mt-1" : "text-sm mt-1.5"}`}>
        {fragment.name}
      </p>
      {!compact && (
        <p className="mt-1 font-mono text-[10px] text-primary/45 leading-relaxed line-clamp-2">
          {fragment.description}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[8px] tracking-widest uppercase text-primary/40">
        <span style={{ color: theme.color }}>{theme.label}</span>
        <span>·</span>
        <span>{TACTIC_LABEL[fragment.tactic] || fragment.tactic}</span>
        <span>·</span>
        <span>{fragment.power == null ? "—" : fragment.power} ATK</span>
        <span>·</span>
        <span>{fragment.mb} MB</span>
      </div>
      {recommended && (
        <span
          className="absolute top-1 right-8 font-mono text-[7px] tracking-[0.2em] uppercase"
          style={{ color: theme.color }}
        >
          Match
        </span>
      )}
    </button>
  );
}
