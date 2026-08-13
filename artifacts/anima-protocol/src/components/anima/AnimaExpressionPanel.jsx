import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Check, Loader, Save, Swords } from "lucide-react";
import {
  EXPRESSION_IDS,
  EXPRESSIONS,
  busterForSpectrum,
  expressionBlendLabel,
  folderFromSpectrum,
  isExpressionBlend,
  mixedAuraColor,
  normalizeSpectrum,
  supportChipsFromSpectrum,
} from "@/lib/animaExpressions";

/**
 * Five-pole expression spectrum editor. Animas can live between multiple
 * expressions at once — raising two sliders is a valid, intended state.
 */
export default function AnimaExpressionPanel({ anima, onSave }) {
  const [spectrum, setSpectrum] = useState(() =>
    normalizeSpectrum(anima?.expression_spectrum),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSpectrum(normalizeSpectrum(anima?.expression_spectrum));
    setSaved(false);
    setError("");
  }, [anima?.id]);

  const original = normalizeSpectrum(anima?.expression_spectrum);
  const dirty = EXPRESSION_IDS.some((id) => spectrum[id] !== original[id]);
  const label = expressionBlendLabel(spectrum);
  const aura = mixedAuraColor(spectrum);
  const blend = isExpressionBlend(spectrum);
  const buster = busterForSpectrum(spectrum);
  const folder = [
    ...folderFromSpectrum(spectrum, { size: 8 }),
    ...supportChipsFromSpectrum(spectrum),
  ];

  const setWeight = (id, value) => {
    setSpectrum((prev) => ({ ...prev, [id]: Number(value) }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!anima?.id) return;
    setSaving(true);
    setError("");
    try {
      const patch = { expression_spectrum: normalizeSpectrum(spectrum) };
      await base44.entities.Anima.update(anima.id, patch);
      onSave?.(patch);
      setSaved(true);
    } catch (err) {
      setError(err?.message || "Failed to save expression spectrum.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className="border bg-black/40 p-5"
        style={{ borderColor: `${aura}55` }}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40">
              // Expression Spectrum
            </p>
            <p
              className="font-mono text-sm tracking-wider mt-1"
              style={{ color: aura }}
            >
              {label}
            </p>
          </div>
          {blend && (
            <span className="font-mono text-[8px] tracking-[0.25em] uppercase border px-2 py-1 text-primary/60 border-primary/25">
              Blend
            </span>
          )}
        </div>
        <p className="font-mono text-[11px] text-primary/45 leading-relaxed mb-5">
          An Anima is not locked to one pole. Raise more than one expression to
          let them live between — Angelic and Ascended, Neutral with a Descended
          undertone, or any mix of the five.
        </p>

        <div className="space-y-4">
          {EXPRESSION_IDS.map((id) => {
            const meta = EXPRESSIONS[id];
            const value = spectrum[id];
            return (
              <label key={id} className="block">
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className="font-mono text-[10px] tracking-[0.2em] uppercase"
                    style={{ color: meta.color }}
                  >
                    {meta.symbol} {meta.name}
                  </span>
                  <span className="font-mono text-[10px] text-primary/50">
                    {Math.round(value)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={value}
                  onChange={(e) => setWeight(id, e.target.value)}
                  className="w-full accent-cyan-400"
                  aria-label={`${meta.name} expression weight`}
                />
                <p className="font-mono text-[10px] text-primary/30 leading-relaxed mt-1">
                  {meta.blurb}
                </p>
              </label>
            );
          })}
        </div>
      </div>

      <div className="border border-primary/15 bg-black/40 p-4">
        <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40 mb-3">
          // Weapons Data
        </p>
        <div className="flex items-center gap-2 mb-3">
          <Swords className="w-3.5 h-3.5 text-primary/50" />
          <p className="font-mono text-[11px] text-primary/70">
            Hand blast · <span style={{ color: buster.color }}>{buster.name}</span>
            {" — "}
            {buster.description}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {folder.slice(0, 8).map((chip, i) => (
            <div
              key={`${chip.id}-${i}`}
              className="border bg-black/50 px-2 py-2"
              style={{ borderColor: `${chip.color}44` }}
            >
              <p
                className="font-mono text-[9px] tracking-wider uppercase"
                style={{ color: chip.color }}
              >
                {chip.letter} {chip.code}
              </p>
              <p className="font-mono text-[11px] text-primary/80 truncate">
                {chip.name}
              </p>
              <p className="font-mono text-[8px] tracking-[0.2em] uppercase text-primary/35 mt-0.5">
                {chip.kind}
              </p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="font-mono text-[11px] text-red-400/80">{error}</p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || saving || !anima?.id}
        className="flex items-center justify-center gap-2 px-5 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed hud-corner"
      >
        {saving ? (
          <Loader className="w-3.5 h-3.5 animate-spin" />
        ) : saved ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Save className="w-3.5 h-3.5" />
        )}
        {saving ? "Saving" : saved ? "Saved" : "Save Spectrum"}
      </button>

      <Link
        to="/net-battle"
        className="inline-flex items-center gap-2 px-4 py-2 border border-amber-400/30 text-amber-200/80 hover:text-amber-100 hover:border-amber-300/50 font-mono text-[10px] tracking-widest uppercase transition-colors"
      >
        <Swords className="w-3.5 h-3.5" />
        Jack into NetBattle
      </Link>
    </div>
  );
}
