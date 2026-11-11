import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { applyUpdate, isUpdateReady, SW_UPDATE_EVENT } from "@/lib/swUpdate";

/**
 * "A new version is ready" bar. Replaces the old silent auto-reload, which
 * could fire mid-reply. Reload waits for any streaming reply to finish.
 */
export default function UpdateAvailablePrompt() {
  const [ready, setReady] = useState(isUpdateReady);
  const [dismissed, setDismissed] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const onReady = () => setReady(true);
    window.addEventListener(SW_UPDATE_EVENT, onReady);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onReady);
  }, []);

  if (!ready || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-available"
      className="fixed left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-2 border border-primary/40 bg-black/90 backdrop-blur-md font-mono text-[10px] tracking-widest uppercase text-primary shadow-lg shadow-black/60"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
    >
      <span>{waiting ? "Updating after this reply…" : "A new version is ready"}</span>
      {!waiting && (
        <>
          <button
            type="button"
            onClick={() => setWaiting(applyUpdate())}
            className="flex items-center gap-1.5 min-h-[32px] px-3 border border-primary/50 hover:bg-primary/20"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" /> Reload
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="min-h-[32px] px-2 text-primary/50 hover:text-primary"
          >
            Later
          </button>
        </>
      )}
    </div>
  );
}
