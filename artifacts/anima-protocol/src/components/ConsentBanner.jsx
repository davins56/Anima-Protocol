// @ts-check
import { useEffect, useState } from "react";
import {
  needsConsentDecision,
  grantConsent,
  revokeConsent,
} from "@/lib/analytics";

// GDPR/CCPA consent gate. Analytics is opted-OUT by default (see analytics.js),
// so no events are sent until the user accepts here. We only show the banner
// when no decision has been recorded yet; mixpanel persists the choice, so it
// does not reappear on return visits.
export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(needsConsentDecision());
  }, []);

  if (!visible) return null;

  const accept = () => {
    grantConsent();
    setVisible(false);
  };

  const decline = () => {
    revokeConsent();
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-primary/30 bg-[#090912]/95 backdrop-blur-sm shadow-[0_-4px_30px_rgba(34,211,238,0.12)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="font-mono text-[11px] leading-relaxed text-primary/70 flex-1">
          We use analytics to understand how Anima Protocol is used and improve
          it. Nothing is collected until you accept.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={decline}
            className="font-mono text-[10px] tracking-[0.2em] uppercase px-4 py-2 border border-primary/25 text-primary/50 hover:text-primary/80 hover:border-primary/40 transition-colors"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            className="font-mono text-[10px] tracking-[0.2em] uppercase px-4 py-2 border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}