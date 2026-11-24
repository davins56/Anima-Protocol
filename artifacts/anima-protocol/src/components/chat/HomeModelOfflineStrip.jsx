import { useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";

/**
 * Chat upgrade 6b (VITE_ANIMA_RICH_PRESENCE): shown above the composer when
 * her home model is offline or she is resting. It only explains and lets the
 * user re-check; it never turns on another model.
 */
export default function HomeModelOfflineStrip({ presence, onCheckAgain }) {
  const [checking, setChecking] = useState(false);
  if (!presence?.detail) return null;
  const check = async () => {
    if (!onCheckAgain || checking) return;
    setChecking(true);
    try {
      await onCheckAgain();
    } finally {
      setChecking(false);
    }
  };
  return (
    <div
      className="mx-2 sm:mx-4 mb-1 flex items-start gap-2 rounded border border-amber-400/30 bg-amber-950/40 px-3 py-2 text-xs text-amber-100/90"
      data-testid="home-model-offline"
      role="status"
    >
      <CloudOff className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-300" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[10px] tracking-widest uppercase text-amber-300/90">{presence.label}</p>
        <p>{presence.detail}</p>
      </div>
      {onCheckAgain && (
        <button
          type="button"
          onClick={check}
          disabled={checking}
          className="inline-flex items-center gap-1 min-h-[36px] px-2 rounded border border-amber-400/40 font-mono text-[10px] tracking-widest uppercase disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${checking ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          Check again
        </button>
      )}
    </div>
  );
}
