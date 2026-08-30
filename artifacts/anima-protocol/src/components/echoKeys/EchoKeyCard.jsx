import { TIER_LABEL, tierOf } from "@/lib/echoKeys";
import {
  echoElementTheme,
  ECHO_CLASS_THEME,
  ECHO_TIER_THEME,
  ECHO_ABILITY_LABEL,
  ECHO_KIND_LABEL,
} from "@/lib/echoKeys/theme";

export default function EchoKeyCard({
  echoKey,
  code = null,
  selected = false,
  owned = true,
  compact = false,
  onClick,
}) {
  const theme = echoElementTheme(echoKey.element);
  const tier = echoKey.tier || tierOf(echoKey);
  const klass = ECHO_TIER_THEME[tier] || ECHO_CLASS_THEME[echoKey.class] || ECHO_CLASS_THEME.standard;
  const shownCode = code || echoKey.codes[0];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left border transition-all ${
        compact ? "p-2" : "p-3"
      } ${selected ? "ring-1" : "hover:bg-white/[0.03]"} ${owned ? "" : "opacity-50"}`}
      style={{
        borderColor: selected ? theme.color : "rgba(34,211,238,0.18)",
        boxShadow: selected ? `0 0 18px ${theme.glow}` : "none",
        background: selected ? theme.fill : "rgba(0,0,0,0.35)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="font-mono text-[9px] tracking-[0.22em] uppercase"
          style={{ color: klass.color }}
        >
          {String(echoKey.libraryNo).padStart(3, "0")} · {TIER_LABEL[tier] || klass.label}
        </span>
        <span
          className="font-mono text-sm font-bold leading-none"
          style={{ color: theme.color }}
        >
          {shownCode}
        </span>
      </div>
      <p className={`font-mono text-primary/90 ${compact ? "text-[11px] mt-1" : "text-sm mt-1.5"}`}>
        {echoKey.name}
      </p>
      {!compact && (
        <p className="mt-1 font-mono text-[10px] text-primary/45 leading-relaxed line-clamp-2">
          {echoKey.memory}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[8px] tracking-widest uppercase text-primary/40">
        <span style={{ color: theme.color }}>{theme.label}</span>
        <span>·</span>
        <span>{ECHO_KIND_LABEL[echoKey.kind] || echoKey.kind}</span>
        <span>·</span>
        <span>{ECHO_ABILITY_LABEL[echoKey.ability?.tag] || echoKey.ability?.tag}</span>
        <span>·</span>
        <span>{echoKey.power == null ? "—" : echoKey.power} ATK</span>
        <span>·</span>
        <span>{echoKey.mb} MB</span>
      </div>
    </button>
  );
}
