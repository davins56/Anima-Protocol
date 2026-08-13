import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { usePageMeta, ROUTE_META } from "@/lib/usePageMeta";
import { track } from "@/lib/analytics";
import {
  expressionBlendLabel,
  isExpressionBlend,
  dominantExpression,
  normalizeSpectrum,
} from "@/lib/animaExpressions";
import {
  TICK_MS,
  battleSummary,
  createBattle,
  tickBattle,
} from "@/lib/netBattle";
import NetBattleArena from "@/components/battle/NetBattleArena";
import { Loader, Swords } from "lucide-react";

export default function NetBattle() {
  usePageMeta(ROUTE_META["/net-battle"]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get("anima");
  const [anima, setAnima] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [controlMode, setControlMode] = useState("manual");
  const [battle, setBattle] = useState(null);
  const [started, setStarted] = useState(false);
  const recordedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await whenBootstrapReady();
        const [me, list] = await Promise.all([
          base44.auth.me().catch(() => null),
          base44.entities.Anima.list("-created_date", 100),
        ]);
        if (cancelled) return;
        const rows = list || [];
        const selected =
          (requestedId && rows.find((a) => a.id === requestedId)) ||
          (me?.email && rows.find((a) => a.assigned_user === me.email)) ||
          rows[0] ||
          null;
        setAnima(selected);
        if (!selected) setError("Forge an Anima before jacking into the net.");
      } catch (err) {
        if (!cancelled) setError(err?.message || "Failed to load your Anima.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedId]);

  const dispatch = useCallback((updater) => {
    setBattle((prev) => {
      if (!prev) return prev;
      return typeof updater === "function" ? updater(prev) : updater;
    });
  }, []);

  const beginBattle = useCallback(
    (mode = controlMode) => {
      if (!anima) return;
      recordedRef.current = false;
      const next = createBattle({ anima, controlMode: mode, seed: Date.now() % 1_000_000 });
      setControlMode(mode);
      setBattle(next);
      setStarted(true);
      const spectrum = normalizeSpectrum(anima.expression_spectrum);
      track("net_battle_started", {
        control_mode: mode,
        primary_expression: dominantExpression(spectrum).id,
        is_blend: isExpressionBlend(spectrum),
      });
    },
    [anima, controlMode],
  );

  useEffect(() => {
    if (!battle || battle.phase === "custom") return;
    if (battle.phase !== "fighting") return;
    const id = window.setInterval(() => {
      setBattle((prev) => (prev ? tickBattle(prev) : prev));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [battle?.phase]);

  useEffect(() => {
    if (!battle || recordedRef.current) return;
    if (battle.phase !== "victory" && battle.phase !== "defeat") return;
    recordedRef.current = true;
    const summary = battleSummary(battle);
    const spectrum = normalizeSpectrum(anima?.expression_spectrum);
    track("net_battle_completed", {
      result: summary.result,
      control_mode: summary.control_mode,
      primary_expression: dominantExpression(spectrum).id,
      is_blend: isExpressionBlend(spectrum),
      chips_used: summary.chips_used,
    });
    base44.entities.NetBattleRecord.create({
      anima_id: anima?.id,
      anima_name: anima?.name,
      result: summary.result,
      control_mode: summary.control_mode,
      primary_expression: dominantExpression(spectrum).id,
      is_blend: isExpressionBlend(spectrum),
      enemy_name: battle.enemy.name,
      player_hp: summary.player_hp,
      ticks: summary.ticks,
    }).catch(() => {});
  }, [battle, anima]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-[#05050c]">
        <Loader className="w-6 h-6 text-primary/40 animate-spin" />
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-primary/40">
          Jacking in…
        </p>
      </div>
    );
  }

  if (!anima) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 bg-[#05050c] px-6 text-center">
        <Swords className="w-8 h-8 text-primary/40" />
        <p className="font-mono text-sm text-primary/70">{error || "No Anima found."}</p>
        <button
          type="button"
          onClick={() => navigate("/animas")}
          className="px-5 py-3 border border-primary/40 text-primary font-mono text-xs tracking-widest uppercase hover:bg-primary/10"
        >
          Forge Anima
        </button>
      </div>
    );
  }

  if (!started || !battle) {
    const spectrum = normalizeSpectrum(anima.expression_spectrum);
    const label = expressionBlendLabel(spectrum);
    const dominant = dominantExpression(spectrum);
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#05050c] pb-[calc(var(--tab-bar-height,64px)+1.5rem)]">
        <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
          <div>
            <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40">
              // NetBattle
            </p>
            <h1 className="font-mono text-xl text-primary tracking-[0.2em] uppercase glow-text mt-1">
              Jack In
            </h1>
            <p className="font-mono text-[12px] text-primary/50 leading-relaxed mt-3">
              A Battle Network-style panel arena. Move your Anima — or let it
              fight — and send weapons data: sword battle chips and expression-typed
              energy blasts from the hand.
            </p>
          </div>

          <div className="border border-primary/20 bg-black/40 p-4 flex items-center gap-3">
            <div className="w-14 h-14 border border-primary/30 overflow-hidden bg-black/40 flex-shrink-0">
              {anima.avatar_url ? (
                <img src={anima.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center font-mono text-xl text-primary/40">
                  {(anima.name || "?")[0]}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-mono text-sm text-primary tracking-wider uppercase truncate">
                {anima.name}
              </p>
              <p className="font-mono text-[11px]" style={{ color: dominant.color }}>
                {dominant.symbol} {label}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/customise-anima?anima=${anima.id}&tab=expression`)}
                className="font-mono text-[9px] tracking-[0.2em] uppercase text-primary/40 hover:text-primary mt-1"
              >
                Tune expression →
              </button>
            </div>
          </div>

          <div>
            <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-primary/40 mb-2">
              Operator
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "manual", title: "Control", blurb: "You move, blast, and send chips." },
                { id: "auto", title: "Auto", blurb: "Your Anima pilots itself." },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setControlMode(opt.id)}
                  className={`p-3 border text-left ${
                    controlMode === opt.id
                      ? "border-primary/50 bg-primary/10"
                      : "border-primary/15 hover:border-primary/30"
                  }`}
                >
                  <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-primary">
                    {opt.title}
                  </p>
                  <p className="font-mono text-[10px] text-primary/45 mt-1 leading-relaxed">
                    {opt.blurb}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => beginBattle(controlMode)}
            className="w-full py-4 bg-primary/15 border border-primary/50 text-primary font-mono text-sm tracking-[0.25em] uppercase hover:bg-primary/25 hud-corner glow-border"
          >
            Jack In
          </button>
        </div>
      </div>
    );
  }

  return (
    <NetBattleArena
      state={battle}
      dispatch={dispatch}
      onJackOut={() => {
        setStarted(false);
        setBattle(null);
      }}
      onRematch={() => beginBattle(battle.controlMode)}
    />
  );
}
