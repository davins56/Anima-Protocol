/**
 * /sim — immersive 4D net-battle on sim-core.
 *   ?seed=123      deterministic local session (default: random)
 *   ?w=60          starting W (0–100)
 *   ?online=1      try POST /api/sim/sessions; falls back to offline practice
 *   ?companion=id  companion piloting the navi (server sessions)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SimConfig } from "@workspace/sim-core";
import SimArena from "@/components/simGame/SimArena";
import { createRemoteSession } from "@/lib/simClient/remote";
import { DEMO_MEMORIES, localConfig } from "@/lib/simClient/demo";

export default function SimGame() {
  const [params] = useSearchParams();
  const startW = Math.min(100, Math.max(0, Number(params.get("w") ?? 60) || 60));
  const companion = params.get("companion") || "serenity";
  const online = params.get("online") === "1";
  const seedParam = Number(params.get("seed"));
  const [run, setRun] = useState(0);
  const [baseSeed] = useState(() => (Date.now() & 0x7fffffff) || 1);
  // Offline practice session: derived, no effect needed.
  const local = useMemo(() => {
    const seed = (Number.isFinite(seedParam) && seedParam > 0 ? seedParam : baseSeed) + run;
    return { config: localConfig(seed, startW, companion), id: null as string | null };
  }, [run, seedParam, baseSeed, startW, companion]);
  const [remote, setRemote] = useState<{ key: string; session: { config: SimConfig; id: string | null } } | null>(null);
  const remoteKey = `${run}|${startW}|${companion}`;

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    createRemoteSession({ characterId: companion, startW }).then((r) => {
      if (!cancelled) setRemote({ key: remoteKey, session: r ? { config: r.config, id: r.id } : local });
    });
    return () => {
      cancelled = true;
    };
  }, [online, companion, startW, remoteKey, local]);

  const session = online ? (remote?.key === remoteKey ? remote.session : null) : local;

  const restart = useCallback(() => setRun((r) => r + 1), []);

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[#02010a]">
      {session ? (
        <SimArena key={`${run}-${session.config.seed}`} config={session.config} sessionId={session.id} memoryLabels={DEMO_MEMORIES} onRestart={restart} />
      ) : (
        <div className="flex h-full items-center justify-center font-mono text-xs text-slate-400">tuning in…</div>
      )}
    </div>
  );
}
