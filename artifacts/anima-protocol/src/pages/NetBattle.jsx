import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import NetBattleArena from "@/components/battle/NetBattleArena";
import { base44 } from "@/api/base44Client";
import { track } from "@/lib/analytics";
import {
  TICK_MS,
  battleSummary,
  createBattle,
  tickBattle,
} from "@/lib/netBattle";
import { dominantExpression } from "@/lib/animaExpressions";
import {
  activeEchoFolder,
  chipsFromEchoFolder,
  normalizeEchoKeyAccount,
} from "@/lib/echoKeys";

function isBlend(spectrum) {
  if (!spectrum || typeof spectrum !== "object") return false;
  return Object.values(spectrum).filter((n) => Number(n) > 8).length > 1;
}

export default function NetBattle() {
  const navigate = useNavigate();
  const [anima, setAnima] = useState(null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const completedRef = useRef(false);
  const echoFolderRef = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [animas, characters, me] = await Promise.all([
          base44.entities.Anima.list("-created_date", 8).catch(() => []),
          base44.entities.Character.list("-created_date", 1).catch(() => []),
          base44.auth.me().catch(() => null),
        ]);
        if (!active) return;
        const nextAnima =
          (animas || []).find((a) => a?._isAnima || a?.is_anima) ||
          animas?.[0] ||
          characters?.[0] ||
          { name: "Serenity" };
        setAnima(nextAnima);

        const account = normalizeEchoKeyAccount(me?.echo_keys);
        const folder = activeEchoFolder(account);
        const echoFolder = chipsFromEchoFolder(folder?.slots || []);
        echoFolderRef.current = echoFolder.length >= 5 ? echoFolder : null;
        const battle = createBattle({
          anima: nextAnima,
          echoFolder: echoFolderRef.current || undefined,
          controlMode: "manual",
        });
        setState(battle);

        const dominant = dominantExpression(nextAnima.expression_spectrum);
        track("net_battle_started", {
          control_mode: "manual",
          primary_expression: dominant.id,
          is_blend: isBlend(nextAnima.expression_spectrum),
        });
      } catch (err) {
        console.warn("NetBattle load failed:", err);
        if (active) {
          setState(createBattle({ anima: { name: "Serenity" }, controlMode: "manual" }));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setState((current) => {
        if (!current || current.phase !== "fighting") return current;
        return tickBattle(current);
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state || completedRef.current) return;
    if (state.phase !== "victory" && state.phase !== "defeat") return;
    completedRef.current = true;
    const dominant = dominantExpression(state.player?.spectrum);
    track("net_battle_completed", {
      ...battleSummary(state),
      primary_expression: dominant.id,
      is_blend: isBlend(state.player?.spectrum),
    });
  }, [state]);

  const rematch = () => {
    completedRef.current = false;
    setState(
      createBattle({
        anima: anima || { name: "Serenity" },
        echoFolder: echoFolderRef.current || undefined,
        controlMode: state?.controlMode || "manual",
      }),
    );
  };

  if (loading || !state) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-[#05070f] font-mono text-cyan-600 text-xs tracking-[0.3em] uppercase">
        Jacking in…
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-[#05070f] text-cyan-100 min-h-screen">
      <div className="w-full max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-mono uppercase tracking-widest text-cyan-400">
            NetBattle Matrix
          </h1>
          <button
            type="button"
            onClick={() => navigate("/echo-keys")}
            className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-500 hover:text-cyan-300"
          >
            Echo Keys Folder
          </button>
        </div>
        <div className="w-full border border-cyan-900/50 bg-[#090d18] rounded-lg overflow-hidden shadow-2xl">
          <NetBattleArena
            state={state}
            dispatch={setState}
            onJackOut={() => navigate("/")}
            onRematch={rematch}
          />
        </div>
      </div>
    </div>
  );
}
