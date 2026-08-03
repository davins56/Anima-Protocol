// @ts-check
import { useEffect, useState } from 'react';
import { useInAppBrowserDetection } from '@/hooks/useInAppBrowserDetection';
import { ExternalLink, AlertTriangle } from 'lucide-react';

export default function InAppBrowserWarning() {
  const isInAppBrowser = useInAppBrowserDetection();
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    if (isInAppBrowser) {
      setShowWarning(true);
    }
  }, [isInAppBrowser]);

  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-background border border-orange-500/40 hud-corner p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0" />
          <h2 className="font-mono text-orange-400 tracking-[0.2em] uppercase text-sm font-semibold">
            Browser Compatibility
          </h2>
        </div>

        <div className="border border-orange-500/20 bg-orange-950/30 px-4 py-3 space-y-2">
          <p className="font-mono text-[10px] text-orange-300/80 tracking-wider leading-relaxed">
            You're using an in-app browser that doesn't support Google Sign-In. This is a security restriction by Google.
          </p>
          <p className="font-mono text-[10px] text-orange-300/70 leading-relaxed">
            To sign in and use this app, please open it in a regular web browser instead.
          </p>
        </div>

        <div className="space-y-2 pt-2">
          <p className="font-mono text-xs text-primary/60 leading-relaxed">
            Copy the address bar URL and paste it into:
          </p>
          <ul className="font-mono text-[9px] text-primary/50 space-y-1 ml-3">
            <li>• Safari (iOS)</li>
            <li>• Chrome or Firefox (Android)</li>
            <li>• Any desktop browser</li>
          </ul>
        </div>

        <button
          onClick={() => setShowWarning(false)}
          className="w-full px-4 py-2 border border-orange-500/50 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 hover:border-orange-400 font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          I Understand
        </button>
      </div>
    </div>
  );
}