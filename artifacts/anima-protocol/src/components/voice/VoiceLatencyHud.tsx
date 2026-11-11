/** Dev HUD: end-of-speech → first audible audio. Shown in dev or with ?voicehud=1. */
import type { LatencyStats } from "@/lib/voice/latency";

export const VOICE_HUD_ENABLED =
  import.meta.env.DEV || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("voicehud"));

function tone(ms: number | null) {
  if (ms == null) return "text-muted-foreground";
  return ms < 800 ? "text-emerald-400" : ms < 1500 ? "text-amber-400" : "text-red-400";
}

export default function VoiceLatencyHud({ stats, status }: { stats: LatencyStats; status: string }) {
  return (
    <div className="font-mono text-[10px] leading-tight border border-border bg-black/70 px-2 py-1 flex gap-3" aria-label="Voice latency">
      <span className="text-muted-foreground">{status}</span>
      <span className={tone(stats.last)}>last {stats.last ?? "—"}ms</span>
      <span className={tone(stats.p50)}>p50 {stats.p50 ?? "—"}</span>
      <span className={tone(stats.p95)}>p95 {stats.p95 ?? "—"}</span>
      <span className="text-muted-foreground">n={stats.count}</span>
    </div>
  );
}
