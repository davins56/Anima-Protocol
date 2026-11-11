/** Tiny launcher: shows a Voice button only when the server has the voice agent enabled. */
import { lazy, Suspense, useEffect, useState } from "react";
import { AudioLines } from "lucide-react";
import { fetchVoiceStatus } from "@/lib/voice/voiceApi";

const SerenityVoicePanel = lazy(() => import("./SerenityVoicePanel"));
let statusCache: Promise<boolean> | null = null;

type Props = React.ComponentProps<typeof SerenityVoicePanel> extends infer P ? Omit<P, "onClose"> : never;

export default function VoiceLauncher(props: Props) {
  const [enabled, setEnabled] = useState(false);
  // Deep link from Shortcuts/App Intents: ?voice=1 opens the panel (Start still needs a tap for audio).
  const [open, setOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("voice") === "1");
  useEffect(() => {
    if (import.meta.env.VITE_SERENITY_VOICE === "off") return;
    statusCache ||= fetchVoiceStatus().then((s) => s.enabled).catch(() => false);
    void statusCache.then(setEnabled);
  }, []);
  if (!enabled) return null;
  if (open) {
    return (
      <Suspense fallback={null}>
        <SerenityVoicePanel {...props} onClose={() => setOpen(false)} />
      </Suspense>
    );
  }
  return (
    <div className="mx-2 mb-1 flex justify-end">
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 border border-primary/30 px-2.5 py-1.5 min-h-[36px] font-mono text-[10px] uppercase tracking-widest text-primary/70 hover:text-primary">
        <AudioLines className="w-3.5 h-3.5" /> Voice
      </button>
    </div>
  );
}
