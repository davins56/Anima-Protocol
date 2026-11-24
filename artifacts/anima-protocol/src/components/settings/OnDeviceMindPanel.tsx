/**
 * Chat upgrade 3 (VITE_ANIMA_ON_DEVICE_MIND, off by default): on-device mind.
 *
 * Downloads and runs Qwen3 in this browser (WebLLM on WebGPU, wllama in
 * WebAssembly as the fallback). It is a local test bench for now: replies here
 * are not written to chat or memory, and the home model stays authoritative.
 * There is no automatic cloud fallback anywhere on this screen.
 */
import { useState } from "react";
import { useOnDeviceMind } from "@/lib/onDevice/useOnDeviceMind";
import { ON_DEVICE_MODELS } from "@/lib/onDevice/models";

function gb(mb: number) {
  return `${(mb / 1024).toFixed(1)} GB`;
}

export default function OnDeviceMindPanel() {
  const mind = useOnDeviceMind();
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const model = mind.loadedModel || mind.pick?.model || null;
  const busy = mind.phase === "loading" || mind.phase === "generating";

  const run = async () => {
    const text = prompt.trim();
    if (!text) return;
    setReply("");
    setError("");
    try {
      const out = await mind.generate(
        [
          { role: "system", content: "You are a warm, concise companion. Reply in a few sentences." },
          { role: "user", content: text },
        ],
        (_delta, full) => setReply(full),
      );
      setReply(out);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "AbortError") setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="border border-primary/15 bg-card p-5 space-y-3" data-testid="on-device-mind-panel">
      <p className="font-mono text-xs text-primary/80 tracking-wider uppercase">On-device mind (experimental)</p>
      <p className="text-[11px] text-primary/50 leading-relaxed">
        Runs a Qwen3 model entirely in this browser. Your home model stays her real mind: nothing typed here is
        saved to chat or memory, and nothing falls back to a cloud model. If this device can&apos;t run it, it
        just says so.
      </p>

      {mind.phase === "probing" && <p className="text-[11px] text-primary/40">Checking this device…</p>}

      {mind.profile && (
        <ul className="text-[11px] font-mono text-primary/50 space-y-0.5" data-testid="on-device-profile">
          <li>Device: {mind.profile.mobile ? "phone or tablet" : "desktop"}</li>
          <li>WebGPU: {mind.profile.webgpu ? (mind.profile.shaderF16 ? "yes (16-bit)" : "yes") : "no"}</li>
          {mind.profile.deviceMemoryGb != null && <li>Memory reported: {mind.profile.deviceMemoryGb} GB</li>}
        </ul>
      )}

      {mind.pick && (
        <div className="space-y-1">
          <p className="text-[11px] text-primary/60" data-testid="on-device-pick">
            {model ? `${model.label}, about ${gb(model.approxDownloadMb)} to download once.` : "No model fits this device."}{" "}
            <span className="text-primary/40">{mind.pick.reason}</span>
          </p>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-primary/40">
            Model
            <select
              className="mt-1 block w-full bg-black/40 border border-primary/20 text-primary/80 text-xs p-2"
              value={mind.modelOverride ?? ""}
              disabled={busy || Boolean(mind.loadedModel)}
              onChange={(e) => mind.chooseModel(e.target.value || null)}
            >
              <option value="">Automatic (recommended)</option>
              {ON_DEVICE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {mind.phase === "loading" && (
        <div className="space-y-1" data-testid="on-device-progress">
          <div className="h-1.5 bg-primary/10">
            <div
              className="h-1.5 bg-cyan-400/70 transition-all"
              style={{ width: `${Math.round((mind.progress?.fraction ?? 0) * 100)}%` }}
            />
          </div>
          <p className="text-[10px] font-mono text-primary/40 truncate">{mind.progress?.text || "Starting…"}</p>
        </div>
      )}

      {mind.phase === "unavailable" && (
        <p className="text-[11px] text-amber-200/80" data-testid="on-device-unavailable">
          On-device mind isn&apos;t available here. Chat keeps using your home model; nothing switches to the cloud.
        </p>
      )}
      {mind.failures.length > 0 && (
        <ul className="text-[10px] font-mono text-amber-200/60 space-y-0.5">
          {mind.failures.map((f, i) => (
            <li key={i}>
              {f.model}: {f.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {!mind.loadedModel && mind.phase !== "loading" && mind.pick?.model && (
          <button
            type="button"
            onClick={() => void mind.load()}
            className="min-h-[40px] px-3 border border-cyan-400/40 text-cyan-200/90 font-mono text-[10px] tracking-widest uppercase"
            data-testid="on-device-load"
          >
            Download and load
          </button>
        )}
        {mind.phase === "loading" && (
          <button
            type="button"
            onClick={mind.cancelLoad}
            className="min-h-[40px] px-3 border border-primary/30 text-primary/70 font-mono text-[10px] tracking-widest uppercase"
          >
            Cancel
          </button>
        )}
        {mind.loadedModel && (
          <button
            type="button"
            onClick={() => void mind.unload()}
            disabled={busy}
            className="min-h-[40px] px-3 border border-primary/30 text-primary/70 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
          >
            Unload
          </button>
        )}
        <button
          type="button"
          onClick={() => void mind.removeFromDevice()}
          disabled={busy}
          className="min-h-[40px] px-3 border border-red-400/30 text-red-300/80 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
        >
          Remove from this device
        </button>
      </div>

      {mind.loadedModel && (
        <div className="space-y-2 border-t border-primary/10 pt-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-primary/40">Test it (stays on this device)</p>
          <textarea
            className="w-full bg-black/40 border border-primary/20 text-primary/80 text-sm p-2"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Say something…"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={mind.phase === "generating" || !prompt.trim()}
              className="min-h-[40px] px-3 border border-cyan-400/40 text-cyan-200/90 font-mono text-[10px] tracking-widest uppercase disabled:opacity-40"
            >
              Reply
            </button>
            {mind.phase === "generating" && (
              <button
                type="button"
                onClick={mind.stop}
                className="min-h-[40px] px-3 border border-primary/30 text-primary/70 font-mono text-[10px] tracking-widest uppercase"
              >
                Stop
              </button>
            )}
          </div>
          {reply && <p className="text-sm text-primary/80 whitespace-pre-wrap" data-testid="on-device-reply">{reply}</p>}
          {error && <p className="text-[11px] text-red-300/80">{error}</p>}
        </div>
      )}
    </div>
  );
}
