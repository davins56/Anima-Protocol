import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { isBrowserOffline } from "@/lib/storeErrorSignals";

/** Clear, app-wide offline state instead of failing requests one by one. */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(isBrowserOffline);

  useEffect(() => {
    const update = () => setOffline(isBrowserOffline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="fixed inset-x-0 z-[60] flex items-center justify-center gap-2 px-3 py-1.5 bg-amber-950/90 border-b border-amber-400/30 font-mono text-[10px] tracking-widest uppercase text-amber-200"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      <WifiOff className="w-3 h-3" aria-hidden="true" />
      You&apos;re offline — chat and saving need a connection
    </div>
  );
}
