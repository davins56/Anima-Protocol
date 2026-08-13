import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  COLS,
  CUSTOM_FULL,
  ROWS,
  fireBuster,
  fireLoadedChip,
  moveUnit,
  openCustom,
  sendWeaponsData,
  setControlMode,
  toggleCustomSelect,
} from "@/lib/netBattle";
import {
  expressionBlendLabel,
  mixedAuraColor,
  dominantExpression,
} from "@/lib/animaExpressions";
import { hasWebGL } from "@/lib/webglSupport";
import useResolvedBattleModels from "@/hooks/useResolvedBattleModels";
import WebGLFallback from "@/components/battle/WebGLFallback";

const NetBattleScene3D = lazy(() => import("./NetBattleScene3D"));

const DIRS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  W: [0, -1],
  S: [0, 1],
  A: [-1, 0],
  D: [1, 0],
};

function HpBar({ label, hp, maxHp, color, align = "left" }) {
  const pct = maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0;
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
      <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-primary/50 truncate">
        {label}
      </p>
      <div className="mt-1 h-2 bg-black/70 border border-white/10 overflow-hidden">
        <div
          className="h-full transition-[width] duration-150"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}` }}
        />
      </div>
      <p className="font-mono text-[10px] mt-0.5" style={{ color }}>
        {Math.max(0, hp)} / {maxHp}
      </p>
    </div>
  );
}

function BattleField2D({ state, dispatch, aura, dominant, fxAt }) {
  return (
    <div
      className="relative w-full max-w-3xl"
      style={{ perspective: "1100px" }}
    >
      <div
        className="grid gap-1.5 sm:gap-2"
        style={{
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          transform: "rotateX(26deg) rotateZ(-3deg)",
          transformOrigin: "center bottom",
        }}
      >
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const row = Math.floor(i / COLS);
          const col = i % COLS;
          const playerHere =
            state.player.col === col && state.player.row === row;
          const enemyHere =
            state.enemy.col === col && state.enemy.row === row;
          const playerSide = col <= 2;
          const fx = fxAt[`${col}-${row}`] || [];
          return (
            <button
              key={`${col}-${row}`}
              type="button"
              disabled={state.controlMode !== "manual" || state.phase !== "fighting"}
              onClick={() => {
                if (state.controlMode !== "manual") return;
                dispatch((s) =>
                  moveUnit(
                    s,
                    "player",
                    col - s.player.col,
                    row - s.player.row,
                  ),
                );
              }}
              className="relative aspect-square border disabled:cursor-default"
              style={{
                background: playerSide ? "rgba(8, 40, 48, 0.85)" : "rgba(40, 10, 18, 0.85)",
                borderColor: playerHere
                  ? aura
                  : enemyHere
                    ? state.enemy.color
                    : playerSide
                      ? "rgba(34,211,238,0.25)"
                      : "rgba(248,113,113,0.25)",
                boxShadow: playerHere
                  ? `0 0 18px ${aura}`
                  : enemyHere
                    ? `0 0 18px ${state.enemy.color}`
                    : "none",
              }}
              aria-label={`Panel ${col + 1},${row + 1}`}
            >
              {playerHere && (
                <div className="absolute inset-1 flex flex-col items-center justify-center">
                  {state.player.avatar_url ? (
                    <img
                      src={state.player.avatar_url}
                      alt=""
                      className="w-8 h-8 sm:w-10 sm:h-10 object-cover border"
                      style={{ borderColor: aura }}
                    />
                  ) : (
                    <span className="font-mono text-lg" style={{ color: aura }}>
                      {dominant.symbol}
                    </span>
                  )}
                </div>
              )}
              {enemyHere && (
                <div className="absolute inset-1 flex items-center justify-center">
                  <span
                    className="font-mono text-xs sm:text-sm tracking-widest"
                    style={{ color: state.enemy.color }}
                  >
                    ▼
                  </span>
                </div>
              )}
              {fx.map((f, i) => (
                <span
                  key={i}
                  className="absolute inset-2 pointer-events-none"
                  style={{
                    background:
                      f.type === "slash"
                        ? `linear-gradient(90deg, transparent, ${f.color}, transparent)`
                        : f.color,
                    borderRadius: f.type === "blast" ? "999px" : 0,
                    opacity: 0.85,
                    boxShadow: `0 0 12px ${f.color}`,
                  }}
                />
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChipCard({ chip, selected, dimmed, onClick }) {
  if (!chip) {
    return (
      <div className="h-20 border border-primary/10 bg-black/30" />
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-20 px-2 py-1.5 border text-left transition-all ${
        selected
          ? "bg-primary/15"
          : dimmed
            ? "opacity-40"
            : "bg-black/50 hover:bg-black/70"
      }`}
      style={{ borderColor: selected ? chip.color : `${chip.color}55` }}
    >
      <p className="font-mono text-[8px] tracking-[0.2em]" style={{ color: chip.color }}>
        {chip.letter} · {chip.code}
      </p>
      <p className="font-mono text-[11px] text-primary/90 leading-tight mt-0.5 line-clamp-2">
        {chip.name}
      </p>
      <p className="font-mono text-[8px] tracking-[0.2em] uppercase text-primary/40 mt-1">
        {chip.kind}
        {chip.damage ? ` · ${chip.damage}` : ""}
        {chip.heal ? ` · +${chip.heal}` : ""}
      </p>
    </button>
  );
}

const AnimaVessel4D = lazy(() => import("@/components/anima/AnimaVessel4D"));

export default function NetBattleArena({ state, dispatch, onJackOut, onRematch }) {
  const aura = mixedAuraColor(state.player.spectrum);
  const blend = expressionBlendLabel(state.player.spectrum);
  const dominant = dominantExpression(state.player.spectrum);
  const webgl = useMemo(() => hasWebGL(), []);
  const models = useResolvedBattleModels(
    { ...state.player, color: aura },
    state.enemy,
  );
  const [inspectVessel, setInspectVessel] = useState(false);

  const fxAt = useMemo(() => {
    const map = {};
    for (const p of state.projectiles) {
      const key = `${p.col}-${p.row}`;
      map[key] = map[key] || [];
      map[key].push({ type: "blast", color: p.color });
    }
    for (const s of state.slashes) {
      const key = `${s.col}-${s.row}`;
      map[key] = map[key] || [];
      map[key].push({ type: "slash", color: s.color });
    }
    return map;
  }, [state.projectiles, state.slashes]);

  useEffect(() => {
    const onKey = (e) => {
      if (state.phase === "custom") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          dispatch((s) => sendWeaponsData(s));
        }
        const num = Number(e.key);
        if (num >= 1 && num <= 5) {
          dispatch((s) => toggleCustomSelect(s, num - 1));
        }
        return;
      }
      if (state.phase !== "fighting") return;
      if (DIRS[e.key]) {
        e.preventDefault();
        if (state.controlMode === "manual") {
          const [dc, dr] = DIRS[e.key];
          dispatch((s) => moveUnit(s, "player", dc, dr));
        }
        return;
      }
      if (e.key === "z" || e.key === "Z" || e.key === " ") {
        e.preventDefault();
        if (state.controlMode === "manual") dispatch((s) => fireBuster(s, "player"));
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        dispatch((s) => fireLoadedChip(s));
      }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        dispatch((s) => openCustom(s));
      }
      if (e.key === "Tab") {
        e.preventDefault();
        dispatch((s) =>
          setControlMode(s, s.controlMode === "auto" ? "manual" : "auto"),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, state.phase, state.controlMode]);

  const customPct = Math.min(100, (state.customGauge / CUSTOM_FULL) * 100);
  const customReady = state.customGauge >= CUSTOM_FULL && state.phase === "fighting";

  const field2d = (
    <BattleField2D
      state={state}
      dispatch={dispatch}
      aura={aura}
      dominant={dominant}
      fxAt={fxAt}
    />
  );

  const onPanelClick = (col, row) => {
    if (state.controlMode !== "manual") return;
    dispatch((s) => moveUnit(s, "player", col - s.player.col, row - s.player.row));
  };

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-[#05050c]">
      <div className="flex items-center gap-3 px-3 sm:px-4 py-2 border-b border-primary/15 bg-black/70">
        <div className="flex-1 min-w-0">
          <HpBar
            label={state.player.name}
            hp={state.player.hp}
            maxHp={state.player.maxHp}
            color={aura}
          />
        </div>
        <div className="flex-shrink-0 text-center px-2">
          <p className="font-mono text-[8px] tracking-[0.3em] uppercase text-primary/40">
            NetBattle{webgl ? " · 4D" : ""}
          </p>
          <p className="font-mono text-[10px]" style={{ color: aura }}>
            {dominant.symbol} {blend}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <HpBar
            label={state.enemy.name}
            hp={state.enemy.hp}
            maxHp={state.enemy.maxHp}
            color={state.enemy.color}
            align="right"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-primary/10">
        <div className="flex border border-primary/20">
          {["manual", "auto"].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => dispatch((s) => setControlMode(s, mode))}
              className={`px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] uppercase ${
                state.controlMode === mode
                  ? "bg-primary/15 text-primary"
                  : "text-primary/40 hover:text-primary/70"
              }`}
            >
              {mode === "manual" ? "Control" : "Auto"}
            </button>
          ))}
        </div>
        <p className="font-mono text-[9px] text-primary/35 tracking-widest uppercase hidden sm:block">
          {state.controlMode === "auto"
            ? "Anima is fighting on its own"
            : "WASD move · Z/Space blast · X chip · C custom"}
        </p>
        <div className="flex items-center gap-3">
          {webgl && (
            <button
              type="button"
              onClick={() => setInspectVessel(true)}
              className="font-mono text-[9px] tracking-[0.2em] uppercase text-primary/40 hover:text-primary"
            >
              Vessel
            </button>
          )}
          <button
            type="button"
            onClick={onJackOut}
            className="font-mono text-[9px] tracking-[0.2em] uppercase text-primary/40 hover:text-primary"
          >
            Jack Out
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center p-3 sm:p-6 overflow-hidden">
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 30% 50%, ${aura}22, transparent 55%), radial-gradient(ellipse at 75% 50%, ${state.enemy.color}22, transparent 55%)`,
          }}
        />
        {webgl ? (
          <WebGLFallback fallback={field2d}>
            <Suspense fallback={field2d}>
              <div className="absolute inset-0 z-0">
                <NetBattleScene3D
                  state={state}
                  models={models}
                  onPanelClick={onPanelClick}
                />
              </div>
            </Suspense>
          </WebGLFallback>
        ) : (
          field2d
        )}

        <AnimatePresence>
          {state.phase === "custom" && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="absolute inset-x-3 bottom-2 sm:inset-x-8 sm:bottom-6 z-20 border border-primary/30 bg-[#090912]/95 p-3 sm:p-4 shadow-[0_0_40px_rgba(34,211,238,0.2)]"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-primary">
                  // Custom — Send weapons data
                </p>
                <p className="font-mono text-[9px] text-primary/40">
                  Tap chips, then SEND
                </p>
              </div>
              <div className="grid grid-cols-5 gap-2 mb-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <ChipCard
                    key={i}
                    chip={state.hand[i]}
                    selected={state.selectedCustom.includes(i)}
                    onClick={() => dispatch((s) => toggleCustomSelect(s, i))}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => dispatch((s) => sendWeaponsData(s))}
                className="w-full py-3 bg-primary/15 border border-primary/50 text-primary font-mono text-xs tracking-[0.25em] uppercase hover:bg-primary/25"
              >
                Send to {state.player.name}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(state.phase === "victory" || state.phase === "defeat") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 backdrop-blur-sm"
            >
              <div className="border border-primary/30 bg-[#090912] px-8 py-7 text-center space-y-4 max-w-sm">
                <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-primary/50">
                  {state.phase === "victory" ? "// Enemy Deleted" : "// You Were Deleted"}
                </p>
                <p
                  className="font-mono text-2xl tracking-widest uppercase"
                  style={{ color: state.phase === "victory" ? aura : "#fb7185" }}
                >
                  {state.phase === "victory" ? "WIN" : "LOSE"}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onRematch}
                    className="flex-1 py-2.5 border border-primary/40 text-primary font-mono text-[10px] tracking-[0.2em] uppercase hover:bg-primary/10"
                  >
                    Rematch
                  </button>
                  <button
                    type="button"
                    onClick={onJackOut}
                    className="flex-1 py-2.5 border border-primary/20 text-primary/60 font-mono text-[10px] tracking-[0.2em] uppercase hover:text-primary"
                  >
                    Jack Out
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="border-t border-primary/15 bg-black/80 px-3 sm:px-4 py-3 space-y-3 pb-[calc(var(--tab-bar-height,64px)+0.75rem)]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[8px] tracking-[0.25em] uppercase text-primary/40 w-14">
            Custom
          </span>
          <button
            type="button"
            disabled={!customReady}
            onClick={() => dispatch((s) => openCustom(s))}
            className="flex-1 h-2 bg-black border border-primary/20 overflow-hidden disabled:cursor-default"
          >
            <div
              className="h-full"
              style={{
                width: `${customPct}%`,
                background: customReady ? aura : "rgba(34,211,238,0.55)",
              }}
            />
          </button>
          <span className="font-mono text-[9px] text-primary/50 w-8 text-right">
            {Math.round(customPct)}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => dispatch((s) => fireBuster(s, "player"))}
            disabled={state.controlMode !== "manual" || state.phase !== "fighting"}
            className="w-20 sm:w-24 border px-2 py-2 disabled:opacity-40"
            style={{ borderColor: `${aura}66` }}
          >
            <p className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color: aura }}>
              Buster
            </p>
            <p className="font-mono text-[10px] text-primary/80 leading-tight">
              {state.buster.name}
            </p>
          </button>
          <div className="flex-1 grid grid-cols-5 gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <ChipCard
                key={i}
                chip={state.loaded[i] || (state.phase === "fighting" ? null : state.hand[i])}
                dimmed={!state.loaded[i]}
                onClick={() => {
                  if (state.loaded[i]) dispatch((s) => fireLoadedChip(s));
                }}
              />
            ))}
          </div>
        </div>

        <p className="font-mono text-[10px] text-primary/40 truncate">
          {state.log[state.log.length - 1] || "Jack in."}
        </p>
      </div>

      <AnimatePresence>
        {inspectVessel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex flex-col bg-[#03040c]"
          >
            <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-primary/15 bg-black/70">
              <p className="font-mono text-[9px] tracking-[0.28em] uppercase text-primary/60">
                {state.player.name} · 4D vessel
              </p>
              <button
                type="button"
                onClick={() => setInspectVessel(false)}
                className="font-mono text-[9px] tracking-[0.2em] uppercase text-primary/50 hover:text-primary"
              >
                Close
              </button>
            </div>
            <div className="relative flex-1 min-h-0">
              <WebGLFallback fallback={field2d}>
                <Suspense fallback={null}>
                  <AnimaVessel4D model={models.player} autoRotate />
                </Suspense>
              </WebGLFallback>
              <p className="pointer-events-none absolute bottom-3 inset-x-0 text-center font-mono text-[8px] tracking-[0.28em] uppercase text-primary/45">
                Drag to turn · Scroll to zoom
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
