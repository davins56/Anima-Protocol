import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import NetBattleArena from "@/components/battle/NetBattleArena";
import { base44 } from "@/api/base44Client";
import { track } from "@/lib/analytics";
import {
  battleSummary,
  createBattle,
  TICK_MS,
  tickBattle,
} from "@/lib/netBattle";
import { dominantExpression, isExpressionBlend } from "@/lib/animaExpressions";
import {
  accountToLibrary,
  echoFolderToChips,
  normalizeEchoKeyAccount,
  normalizeEchoLibrary,
  recordCriticalBattle,
} from "@/lib/echoKeys";

function battleReducer(state, action) {
  if (typeof action === "function") return action(state);
  if (action?.type === "replace") return action.state;
  if (action?.type === "tick") return tickBattle(state);
  return state;
}

function spectrumMeta(spectrum) {
  const dominant = dominantExpression(spectrum);
  return {
    primary_expression: dominant.id,
    is_blend: isExpressionBlend(spectrum),
  };
}

export default function NetBattle() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [anima, setAnima] = useState(null);
  const [library, setLibrary] = useState(() => normalizeEchoLibrary(null));
  const [loading, setLoading] = useState(true);
  const [seed, setSeed] = useState(() => Date.now() % 1_000_000);
  const trackedEnd = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const animaId = searchParams.get("anima");
        const [animas, profile] = await Promise.all([
          base44.entities.Anima.list("-created_date", 20).catch(() => []),
          base44.auth.me().catch(() => null),
        ]);
        if (!active) return;
        const chosen =
          (animaId && animas?.find((a) => a.id === animaId)) ||
          animas?.[0] ||
          null;
        setAnima(chosen);
        setLibrary(normalizeEchoLibrary(profile?.settings?.echo_keys));
      } catch (err) {
        console.warn("NetBattle load failed:", err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [searchParams]);

  const [state, dispatch] = useReducer(battleReducer, null, () =>
    createBattle({
      anima: { name: "Anima" },
      controlMode: "manual",
      seed,
      echoFolder: echoFolderToChips(library),
    }),
  );

  const jackIn = useCallback(
    (nextSeed = Date.now() % 1_000_000) => {
      trackedEnd.current = false;
      const next = createBattle({
        anima: anima || { name: "Anima" },
        controlMode: "manual",
        seed: nextSeed,
        echoFolder: echoFolderToChips(library),
      });
      setSeed(nextSeed);
      dispatch({ type: "replace", state: next });
      const meta = spectrumMeta(anima?.expression_spectrum);
      track("net_battle_started", {
        control_mode: "manual",
        ...meta,
      });
    },
    [anima, library],
  );

  useEffect(() => {
    if (loading) return;
    jackIn(seed);
    // First jack-in after Anima / library resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, anima?.id, library.folder?.length]);

  useEffect(() => {
    if (state.phase !== "fighting") return undefined;
    const id = setInterval(() => dispatch({ type: "tick" }), TICK_MS);
    return () => clearInterval(id);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "victory" && state.phase !== "defeat") return;
    if (trackedEnd.current) return;
    trackedEnd.current = true;
    const summary = battleSummary(state);
    const meta = spectrumMeta(state.player.spectrum);
    track("net_battle_completed", {
      ...summary,
      ...meta,
      echo_keys_used: summary.chips_used,
    });
    if (state.phase === "victory" && state.player?.maxHp) {
      const ratio = state.player.hp / state.player.maxHp;
      const account = normalizeEchoKeyAccount(library);
      const next = recordCriticalBattle(account, {
        folderIds: (library.folder || []).map((slot) => slot.id),
        integrityRatio: ratio,
        survived: true,
      });
      if (next.progressed) {
        const saved = accountToLibrary(next.account);
        setLibrary(saved);
        base44.auth
          .updateMe({
            settings: { echo_keys: saved },
          })
          .catch(() => {});
        if (next.evolved) {
          track("echo_key_discovered", {
            source: "evolution",
            site: "none",
            tier: next.evolved.tier || "key",
            is_outdoor: false,
          });
        }
      }
    }
  }, [state, library]);

  const handleJackOut = () => navigate("/echo-keys");
  const handleRematch = () => jackIn();

  if (loading) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center bg-[#05070f] text-cyan-500 font-mono text-[10px] tracking-[0.3em] uppercase">
        Jacking in…
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-[#05070f] text-cyan-100 min-h-screen pb-[var(--tab-bar-height,64px)]">
      <div className="w-full max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-mono uppercase tracking-widest text-cyan-400">
            NetBattle Matrix
          </h1>
          <button
            type="button"
            onClick={() => navigate("/echo-keys")}
            className="text-[9px] font-mono uppercase tracking-[0.22em] text-amber-200/70 hover:text-amber-100"
          >
            Echo Keys · {library.owned_ids.length}
          </button>
        </div>
        <div className="w-full border border-cyan-900/50 bg-[#090d18] rounded-lg overflow-hidden shadow-2xl min-h-[70vh]">
          <NetBattleArena
            state={state}
            dispatch={dispatch}
            onJackOut={handleJackOut}
            onRematch={handleRematch}
          />
        </div>
      </div>
    </div>
  );
}
