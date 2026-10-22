import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { animaApi } from "@/api/animaApi";

/**
 * Adult-mode age check. The server checks the date of birth, stores an
 * attestation (birth year, age, timestamp — not the full date) and enforces
 * it on every chat turn. This dialog only reflects the server's answer.
 */
export default function AgeGateDialog({ onCancel, onAttested, api = animaApi }) {
  const [dob, setDob] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.safety.attestAge(dob);
      if (res?.adult_eligible) onAttested?.();
      else setError("Adult mode isn't available.");
    } catch (err) {
      setError(err?.message || "Couldn't check that right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
      <div role="dialog" aria-label="Age verification" className="w-full max-w-sm bg-background border border-rose-500/40 hud-corner p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <h2 className="font-mono text-rose-400 tracking-[0.2em] uppercase text-sm">Age Verification</h2>
        </div>
        <p className="font-mono text-[10px] text-rose-300/80 tracking-wider leading-relaxed border border-rose-500/20 bg-rose-950/30 px-4 py-3">
          Adult mode enables explicit content and is for people 18 and over. We keep your birth year and the
          time you confirmed, not your full date of birth.
        </p>
        <label className="block space-y-1">
          <span className="font-mono text-[10px] text-primary/60 uppercase tracking-widest">Date of birth</span>
          <input
            type="date"
            data-testid="age-gate-dob"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-xs px-2.5 py-2"
          />
        </label>
        <label className="flex items-start gap-2 font-mono text-[10px] text-primary/60">
          <input
            type="checkbox"
            data-testid="age-gate-confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I confirm this is my real date of birth and I consent to adult content.</span>
        </label>
        {error && (
          <p role="alert" className="font-mono text-[10px] text-rose-400">
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary font-mono text-xs tracking-widest uppercase"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="age-gate-submit"
            disabled={!dob || !confirmed || busy}
            onClick={submit}
            className="flex-1 px-4 py-2 bg-rose-900/30 border border-rose-500/60 text-rose-400 font-mono text-xs tracking-widest uppercase disabled:opacity-40"
          >
            {busy ? "Checking…" : "Verify & enable"}
          </button>
        </div>
      </div>
    </div>
  );
}
