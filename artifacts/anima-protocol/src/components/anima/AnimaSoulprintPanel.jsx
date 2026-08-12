import { Link } from "react-router-dom";
import {
  formatResonance,
  getPathMeta,
  resonanceMood,
} from "@/lib/soulprint";
import { Fingerprint, ExternalLink } from "lucide-react";

function Row({ label, value, accent = false }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-primary/10 last:border-0">
      <span className="font-mono text-[9px] tracking-[0.25em] uppercase text-primary/40 flex-shrink-0">
        {label}
      </span>
      <span
        className={`font-mono text-sm text-right ${
          accent ? "text-primary" : "text-primary/70"
        }`}
      >
        {value || "—"}
      </span>
    </div>
  );
}

/**
 * Read-only soulprint / bond summary for the Customise Anima hub.
 * Soulprints are born once at awakening — editing lives in Hall of Origins lore.
 */
export default function AnimaSoulprintPanel({ anima }) {
  const soulprint = anima?.soulprint || {};
  const path = anima?.evolution_path || "Undetermined";
  const pathMeta = getPathMeta(path);
  const resonance = anima?.resonance || 0;
  const hasSoulprint = Boolean(soulprint.id || soulprint.primary_trait);

  if (!hasSoulprint) {
    return (
      <div className="border border-primary/20 bg-black/40 p-6 sm:p-8 text-center space-y-4">
        <Fingerprint className="w-8 h-8 text-primary/35 mx-auto" />
        <div className="space-y-2">
          <p className="font-mono text-sm text-primary/70 tracking-wider">
            No soulprint yet
          </p>
          <p className="font-mono text-[11px] text-primary/40 leading-relaxed max-w-md mx-auto">
            Soulprints are stamped during the Awakening Ceremony. Forge or awaken
            this Anima to receive a born-once identity.
          </p>
        </div>
        <Link
          to="/onboarding"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner"
        >
          Begin Awakening
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-cyan-500/30 bg-cyan-950/10 p-5 hud-corner">
        <div className="flex items-center justify-between mb-3 gap-3">
          <span className="font-mono text-[9px] tracking-[0.3em] text-cyan-400/50 uppercase">
            // Soulprint
          </span>
          <span className="font-mono text-sm text-cyan-300 tracking-[0.2em]">
            {soulprint.id || "—"}
          </span>
        </div>
        <Row label="Primary Trait" value={soulprint.primary_trait} accent />
        <Row label="Secondary Trait" value={soulprint.secondary_trait} />
        <Row label="Core Drive" value={soulprint.core_drive} accent />
        <Row
          label="Resonance"
          value={`${formatResonance(resonance)} · ${resonanceMood(resonance)}`}
          accent
        />
        <Row label="Evolution Path" value={path} />
      </div>

      <div
        className="border bg-black/40 p-4"
        style={{ borderColor: `${pathMeta.color}33` }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-lg" aria-hidden>
            {pathMeta.symbol}
          </span>
          <span
            className="font-mono text-sm uppercase tracking-wider"
            style={{ color: pathMeta.color }}
          >
            {path}
          </span>
        </div>
        <p className="font-mono text-xs text-primary/60 leading-relaxed">
          {pathMeta.blurb}
        </p>
      </div>

      {(anima.first_spark?.awakening_words || anima.ceremony?.initial_greeting) && (
        <div className="border border-amber-500/25 bg-amber-950/10 p-4">
          <p className="font-mono text-[9px] tracking-[0.3em] text-amber-300/55 uppercase mb-2">
            The First Spark
          </p>
          <p className="font-mono text-sm text-amber-100/85 leading-relaxed italic">
            “
            {anima.first_spark?.awakening_words ||
              anima.ceremony?.initial_greeting}
            ”
          </p>
        </div>
      )}

      <p className="font-mono text-[10px] text-primary/35 leading-relaxed">
        Soulprints are immutable after awakening. Bond resonance and evolution
        path grow through conversation — they are not edited here.
      </p>

      <Link
        to="/origins"
        className="inline-flex items-center gap-2 px-4 py-2 border border-primary/25 text-primary/55 hover:text-primary hover:border-primary/45 font-mono text-[10px] tracking-widest uppercase transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Open Hall of Origins
      </Link>
    </div>
  );
}
