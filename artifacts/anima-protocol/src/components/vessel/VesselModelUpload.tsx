/**
 * Upload a companion's own VRM / GLB body (one per companion; replacing is a
 * new upload and a new vessel version). Uses the signed direct-to-storage
 * flow in lib/vessel/vesselModelUpload; the preview canvas picks the new model
 * up from the returned vessel config.
 */
import { useRef, useState } from "react";
import type { VesselConfig } from "@/lib/vessel/vesselConfig";
import type { VesselRecord } from "@/lib/vessel/vesselApi";
import { uploadErrorMessage, uploadVesselModel, validateModelFile, type UploadPhase } from "@/lib/vessel/vesselModelUpload";

type Props = {
  characterId?: string;
  model: VesselConfig["model"];
  /** New vessel version written by /model/complete. */
  onUploaded: (vessel: VesselRecord) => void;
  /** Switch back to the procedural vessel (takes effect on the next saved version). */
  onUseProcedural: () => void;
};

const PHASE_LABEL: Record<UploadPhase, string> = {
  validating: "Checking file…",
  signing: "Preparing upload…",
  uploading: "Uploading",
  processing: "Reading model…",
  done: "Model ready",
};

function mb(n?: number) {
  return n ? `${(n / 1048576).toFixed(1)} MB` : "";
}

export default function VesselModelUpload({ characterId, model, onUploaded, onUseProcedural }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const busy = phase !== null && phase !== "done";
  const hasModel = model.kind !== "procedural" && Boolean(model.url);

  const start = async (file: File | undefined | null) => {
    if (!file || busy) return;
    setError("");
    setProgress(0);
    if (!characterId) {
      setError("Choose a companion first.");
      return;
    }
    // Fast local rejection before asking the API for a signed URL.
    const v = await validateModelFile(file);
    if (v.ok === false) {
      setError(v.message);
      return;
    }
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const out = await uploadVesselModel(characterId, file, { onPhase: setPhase, onProgress: setProgress, signal: ctl.signal });
      onUploaded(out.vessel);
    } catch (e) {
      setPhase(null);
      setError((e as Error)?.name === "AbortError" ? "Upload cancelled." : uploadErrorMessage(e));
    } finally {
      abort.current = null;
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2" data-testid="vessel-model-upload">
      {hasModel && (
        <div className="font-mono text-[10px] text-muted-foreground space-y-0.5" data-testid="vessel-model-current">
          <p className="text-primary/80">
            Using uploaded {model.kind === "vrm" ? "VRM" : "GLB"} {mb(model.byteSize)}
            {model.humanoid ? " · humanoid" : ""}
          </p>
          {model.kind === "vrm" && (
            <p>
              {model.expressions?.length ?? 0} expressions · lip-sync {model.visemes?.length ? model.visemes.join("/") : "none"}
            </p>
          )}
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a VRM or GLB model"
        aria-disabled={busy || !characterId}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void start(e.dataTransfer?.files?.[0]);
        }}
        className={`border border-dashed px-3 py-4 text-center font-mono text-[11px] cursor-pointer select-none ${drag ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"} ${busy || !characterId ? "opacity-60" : ""}`}
      >
        {hasModel ? "Replace model — drop a .vrm / .glb or tap" : "Drop a .vrm / .glb here or tap to choose"}
        <p className="text-[10px] opacity-70 mt-1">Single file, up to 50 MB. VRM gets expressions and lip-sync.</p>
        <input
          ref={input}
          type="file"
          accept=".vrm,.glb,model/gltf-binary,model/vrm"
          className="hidden"
          data-testid="vessel-model-input"
          onChange={(e) => void start(e.target.files?.[0])}
        />
      </div>
      {phase && (
        <div className="space-y-1" aria-live="polite">
          <p className="font-mono text-[10px] text-primary/80">
            {PHASE_LABEL[phase]}
            {phase === "uploading" ? ` ${Math.round(progress * 100)}%` : ""}
          </p>
          {phase === "uploading" && (
            <div className="h-1 bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div className="h-1 bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {busy && phase === "uploading" && (
            <button type="button" onClick={() => abort.current?.abort()} className="font-mono text-[10px] text-muted-foreground underline">
              Cancel
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="font-mono text-[10px] text-red-400">
          {error}
        </p>
      )}
      {hasModel && !busy && (
        <button
          type="button"
          onClick={() => {
            setPhase(null);
            onUseProcedural();
          }}
          className="w-full min-h-[36px] border border-border font-mono text-[10px] tracking-widest uppercase text-muted-foreground"
        >
          Use procedural vessel instead
        </button>
      )}
    </div>
  );
}
