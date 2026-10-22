/**
 * /vessel?character=<id>&name=<name>  — full 3D vessel view + customization.
 * Saving creates a new vessel version, a new identity-core version and a
 * `vessel_changed` memory event; an optional snapshot becomes a photo reference.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import VesselCustomizer from "@/components/vessel/VesselCustomizer";
import type { VesselCanvasHandle } from "@/components/vessel/VesselCanvas";
import { defaultVesselFor, type VesselConfig } from "@/lib/vessel/vesselConfig";
import { expressionFor } from "@/lib/vessel/emotion";
import { MOODS } from "@/lib/moodDetector";
import { fetchVessel, saveVessel, uploadVesselSnapshot } from "@/lib/vessel/vesselApi";
import { loadCustomiseAnimaCompanions } from "@/lib/loadCustomiseAnimaCompanions";

const VesselCanvas = lazy(() => import("@/components/vessel/VesselCanvas"));

type Companion = { id: string; name: string };

export default function VesselStudio() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const characterId = params.get("character") || "";
  const [companions, setCompanions] = useState<Companion[]>([]);
  const name = params.get("name") || companions.find((c) => c.id === characterId)?.name || "";
  const [config, setConfig] = useState<VesselConfig>(() => defaultVesselFor({ name }));
  const [version, setVersion] = useState<number | null>(null);
  const [hd, setHd] = useState(false);
  const [mood, setMood] = useState("neutral");
  const [note, setNote] = useState("");
  const [withSnapshot, setWithSnapshot] = useState(true);
  const [status, setStatus] = useState("");
  const canvas = useRef<VesselCanvasHandle>(null);

  useEffect(() => {
    loadCustomiseAnimaCompanions({ limit: 200 })
      .then((r: { rows?: Companion[] }) => setCompanions((r.rows || []).map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!characterId) return;
    fetchVessel(characterId, true)
      .then((v) => {
        setVersion(v?.version ?? null);
        setConfig(v ? v.config : defaultVesselFor({ name }));
      })
      .catch((e) => setStatus(String(e?.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const expression = useMemo(() => expressionFor(mood, 70), [mood]);

  const save = async () => {
    if (!characterId) return;
    setStatus("Saving…");
    try {
      let snapshot = null;
      const dataUrl = withSnapshot ? canvas.current?.snapshot("image/jpeg", 0.85) : null;
      if (dataUrl) snapshot = await uploadVesselSnapshot(characterId, dataUrl).catch(() => null);
      const out = await saveVessel({ characterId, name, config, changeNote: note, snapshot });
      setVersion(out.vessel.version);
      setNote("");
      setStatus(`Saved vessel v${out.vessel.version} · identity v${out.identity_version}`);
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <div className="relative flex-1 min-h-[50vh] md:min-h-0 bg-black/40">
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center font-mono text-xs text-primary/60">Loading vessel…</div>}>
          <VesselCanvas ref={canvas} config={config} expression={expression} mode="full" hd={hd} className="absolute inset-0" />
        </Suspense>
        <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1.5">
          <select
            value={characterId}
            onChange={(e) => setParams({ character: e.target.value })}
            className="bg-background/80 border border-border font-mono text-xs px-2 py-1.5"
          >
            <option value="">Choose companion…</option>
            {companions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            {characterId && !companions.some((c) => c.id === characterId) && <option value={characterId}>{name || characterId}</option>}
          </select>
          <select value={mood} onChange={(e) => setMood(e.target.value)} className="bg-background/80 border border-border font-mono text-xs px-2 py-1.5" aria-label="Preview emotion">
            {Object.keys(MOODS).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button type="button" onClick={() => setHd((h) => !h)} className={`border px-2 py-1.5 font-mono text-xs ${hd ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
            {hd ? "HD" : "Lite"}
          </button>
          {characterId && (
            <button type="button" onClick={() => navigate(-1)} className="ml-auto border border-border px-2 py-1.5 font-mono text-xs text-muted-foreground">
              Back
            </button>
          )}
        </div>
      </div>
      <aside className="w-full md:w-[360px] md:border-l border-border overflow-y-auto p-4 space-y-4">
        <p className="font-mono text-xs text-primary tracking-widest uppercase">
          Vessel {name ? `· ${name}` : ""} {version ? `· v${version}` : "· unsaved"}
        </p>
        <VesselCustomizer value={config} onChange={setConfig} />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="What changed? (stored in memory)" className="w-full bg-transparent border border-border px-2 py-2 text-sm" />
        <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <input type="checkbox" checked={withSnapshot} onChange={(e) => setWithSnapshot(e.target.checked)} /> Save a snapshot as photo reference
        </label>
        <button type="button" disabled={!characterId} onClick={save} className="w-full min-h-[44px] border border-primary bg-primary/15 text-primary font-mono text-xs tracking-widest uppercase disabled:opacity-40">
          Save new version
        </button>
        {status && <p className="font-mono text-[11px] text-muted-foreground">{status}</p>}
      </aside>
    </div>
  );
}
