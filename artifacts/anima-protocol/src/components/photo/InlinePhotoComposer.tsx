/**
 * Inline photo studio docked above the chat composer. Generates an
 * identity-locked photo of the active companion, streams progress, and shares
 * the result into the thread as a normal image attachment (with photo_id so
 * the bubble can offer refinements).
 */
import { useEffect, useMemo, useState } from "react";
import { Camera, Loader, RefreshCw, RotateCw, Shirt, Smile, X, Lock, Send } from "lucide-react";
import { usePhotoGeneration } from "@/hooks/usePhotoGeneration";
import {
  PHOTO_REFINE_EVENT,
  type PhotoRefineDetail,
  type RefinementOp,
  type SceneSpec,
} from "@/lib/photo/photoApi";
import IdentityLockPanel from "./IdentityLockPanel";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { vesselToDescriptorPhrases } from "@/lib/vessel/vesselConfig";

type Companion = { id: string; name?: string; avatar_url?: string; _isAnima?: boolean };

export type InlinePhotoComposerProps = {
  character: Companion;
  sessionId?: string | null;
  onShare: (args: { url: string; imageId: string; prompt: string; characterId: string }) => void | Promise<void>;
  onClose: () => void;
  /** Optional extra anchors/snapshot (3D vessel integration). */
  extraDescriptor?: string[];
  extraReferenceUrl?: string;
};

const CHIPS: Record<keyof Pick<SceneSpec, "mood" | "lighting" | "composition">, string[]> = {
  mood: ["tender", "playful", "serene", "fierce", "melancholic", "flirtatious"],
  lighting: ["golden hour", "soft window light", "neon night", "candlelit", "overcast daylight", "rim-lit studio"],
  composition: ["close-up portrait", "half-body", "full-body", "over-the-shoulder", "candid wide shot"],
};

const REFINES: Array<{ op: RefinementOp; label: string; icon: typeof RefreshCw; ask?: string }> = [
  { op: "regenerate", label: "Again", icon: RefreshCw },
  { op: "vary_angle", label: "Angle", icon: RotateCw, ask: "New angle (e.g. profile, low angle)" },
  { op: "outfit", label: "Outfit", icon: Shirt, ask: "New outfit" },
  { op: "expression", label: "Expression", icon: Smile, ask: "New expression" },
];

export default function InlinePhotoComposer({
  character,
  sessionId,
  onShare,
  onClose,
  extraDescriptor,
  extraReferenceUrl,
}: InlinePhotoComposerProps) {
  const { state, run, cancel, reset } = usePhotoGeneration();
  const [prompt, setPrompt] = useState("");
  const [scene, setScene] = useState<SceneSpec>({});
  const [refineOp, setRefineOp] = useState<RefinementOp | null>(null);
  const [refineValue, setRefineValue] = useState("");
  const [showIdentity, setShowIdentity] = useState(false);
  const [shared, setShared] = useState(false);
  const busy = state.phase === "queued" || state.phase === "running";
  const { vessel } = useCharacterVessel(character.id);
  const [matchVessel, setMatchVessel] = useState(true);

  const base = useMemo(() => {
    const useVessel = Boolean(vessel && matchVessel);
    return {
      characterId: character.id,
      characterName: character.name,
      sessionId: sessionId || null,
      extraDescriptor: useVessel ? [...(extraDescriptor || []), ...vesselToDescriptorPhrases(vessel!.config)] : extraDescriptor,
      extraReferenceUrl,
      useVesselReference: useVessel && Boolean(vessel?.snapshot_path),
    };
  }, [character.id, character.name, sessionId, extraDescriptor, extraReferenceUrl, vessel, matchVessel]);

  const generate = (op: RefinementOp = "new", value?: string, parentImageId?: string) => {
    setShared(false);
    void run({
      ...base,
      prompt,
      scene,
      refinement: op === "new" ? undefined : { op, value, parentImageId: parentImageId || state.imageId },
    });
  };

  // Refinements requested from an image already in the thread.
  useEffect(() => {
    const handler = (ev: Event) => {
      const d = (ev as CustomEvent<PhotoRefineDetail>).detail;
      if (!d?.imageId || (d.characterId && d.characterId !== character.id)) return;
      if (d.op === "regenerate" || d.value) generate(d.op, d.value, d.imageId);
      else setRefineOp(d.op);
    };
    window.addEventListener(PHOTO_REFINE_EVENT, handler);
    return () => window.removeEventListener(PHOTO_REFINE_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, base, prompt, scene]);

  const toggleChip = (key: keyof typeof CHIPS, v: string) =>
    setScene((s) => ({ ...s, [key]: s[key] === v ? undefined : v }));

  const statusText =
    state.phase === "queued"
      ? state.queuePosition != null
        ? `Queued · ${state.queuePosition} ahead`
        : "Queued…"
      : state.phase === "running"
        ? state.log || "Developing…"
        : "";

  return (
    <div className="mx-2 mb-2 border border-primary/30 bg-black/80 backdrop-blur-sm hud-corner" role="region" aria-label="Photo studio">
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/15">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="w-4 h-4 text-primary" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary truncate">
            Photo · {character.name || "Companion"}
          </span>
          <button
            type="button"
            onClick={() => setShowIdentity((v) => !v)}
            className="ml-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-primary/50 hover:text-primary"
            title="Locked visual identity"
          >
            <Lock className="w-3 h-3" /> Identity
          </button>
          {vessel && (
            <button
              type="button"
              onClick={() => setMatchVessel((v) => !v)}
              className={`ml-1 font-mono text-[9px] uppercase tracking-widest ${matchVessel ? "text-primary" : "text-primary/40"}`}
              title="Match the saved 3D vessel look"
              aria-pressed={matchVessel}
            >
              Vessel v{vessel.version}
            </button>
          )}
          <a href={`/vessel?character=${encodeURIComponent(character.id)}&name=${encodeURIComponent(character.name || "")}`} className="ml-1 font-mono text-[9px] uppercase tracking-widest text-primary/50 hover:text-primary">
            3D
          </a>
        </div>
        <button type="button" onClick={onClose} className="text-primary/40 hover:text-primary p-1" aria-label="Close photo studio">
          <X className="w-4 h-4" />
        </button>
      </div>

      {showIdentity && <IdentityLockPanel characterId={character.id} characterName={character.name} fallbackAvatar={character.avatar_url} />}

      <div className="p-3 space-y-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          disabled={busy}
          placeholder={`Describe the scene… e.g. "${character.name || "she"} laughing on a rainy Tokyo street at night"`}
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/25 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 resize-none"
        />
        {(Object.keys(CHIPS) as Array<keyof typeof CHIPS>).map((key) => (
          <div key={key} className="flex gap-1 overflow-x-auto no-scrollbar">
            <span className="font-mono text-[8px] uppercase tracking-widest text-primary/30 self-center w-16 flex-shrink-0">{key}</span>
            {CHIPS[key].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => toggleChip(key, v)}
                className={`flex-shrink-0 px-2 py-1 border font-mono text-[10px] ${
                  scene[key] === v ? "border-primary text-primary bg-primary/15" : "border-primary/15 text-primary/50"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        ))}

        {(busy || state.phase === "done" || state.phase === "error") && (
          <div className="relative border border-primary/20 bg-black/50 min-h-[8rem] flex items-center justify-center overflow-hidden">
            {state.url ? (
              <img src={state.url} alt={`${character.name} generated`} className="w-full max-h-80 object-contain" decoding="async" />
            ) : busy ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <Loader className="w-5 h-5 text-primary animate-spin" />
                <span className="font-mono text-[10px] text-primary/60 tracking-widest uppercase">{statusText}</span>
              </div>
            ) : null}
            {state.phase === "error" && (
              <p className="p-3 font-mono text-[11px] text-red-400/80">
                {state.errorCode === "identity_missing" ? "Add a reference photo under Identity first." : state.error}
              </p>
            )}
          </div>
        )}

        {state.phase === "done" && state.imageId && (
          <div className="flex flex-wrap gap-1">
            {REFINES.map(({ op, label, icon: Icon, ask }) => (
              <button
                key={op}
                type="button"
                onClick={() => (ask ? setRefineOp(op) : generate(op))}
                className="flex items-center gap-1 px-2 py-1 border border-primary/20 text-primary/70 font-mono text-[10px] uppercase"
              >
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>
        )}

        {refineOp && (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              generate(refineOp, refineValue.trim() || undefined);
              setRefineOp(null);
              setRefineValue("");
            }}
          >
            <input
              autoFocus
              value={refineValue}
              onChange={(e) => setRefineValue(e.target.value)}
              placeholder={REFINES.find((r) => r.op === refineOp)?.ask}
              className="flex-1 bg-black/60 border border-primary/20 text-primary/80 font-mono text-xs px-2 py-1.5 focus:outline-none"
            />
            <button type="submit" className="px-3 border border-primary/40 text-primary font-mono text-[10px] uppercase">
              Apply
            </button>
          </form>
        )}

        <div className="flex gap-2">
          {busy ? (
            <button type="button" onClick={cancel} className="flex-1 py-2 border border-primary/20 text-primary/50 font-mono text-xs uppercase tracking-widest">
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => generate("new")}
              disabled={!prompt.trim() && !scene.mood && !scene.lighting}
              className="flex-1 py-2 bg-primary/10 border border-primary/40 text-primary font-mono text-xs uppercase tracking-widest disabled:opacity-30 flex items-center justify-center gap-2"
            >
              <Camera className="w-3 h-3" /> Generate
            </button>
          )}
          {state.phase === "done" && state.url && state.imageId && (
            <button
              type="button"
              disabled={shared}
              onClick={async () => {
                await onShare({ url: state.url!, imageId: state.imageId!, prompt: prompt || state.prompt || "", characterId: character.id });
                setShared(true);
              }}
              className="flex-1 py-2 border border-primary/40 text-primary font-mono text-xs uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Send className="w-3 h-3" /> {shared ? "Shared" : "Share to chat"}
            </button>
          )}
          {state.phase === "error" && (
            <button type="button" onClick={reset} className="px-3 border border-primary/20 text-primary/50 font-mono text-[10px] uppercase">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
