import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { COLS, ROWS } from "@/lib/netBattle";
import { CELL, PANEL_SIZE, PANEL_THICKNESS, panelWorldPosition } from "@/lib/battleLayout";
import {
  BattleProjectile,
  SerenityFigure,
  VirusFigure,
} from "./BattleFigures3D";

function Panel({ col, row, playerHere, enemyHere, playerColor, enemyColor, onClick, clickable }) {
  const [x, y, z] = panelWorldPosition(col, row);
  const playerSide = col <= 2;
  const occupied = playerHere || enemyHere;
  const color = playerHere
    ? playerColor
    : enemyHere
      ? enemyColor
      : playerSide
        ? "#083038"
        : "#2a0c14";
  const emissive = occupied ? (playerHere ? playerColor : enemyColor) : playerSide ? "#155e75" : "#7f1d1d";

  return (
    <mesh
      position={[x, y, z]}
      onClick={(e) => {
        e.stopPropagation();
        if (clickable) onClick?.(col, row);
      }}
      onPointerOver={(e) => {
        if (!clickable) return;
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <boxGeometry args={[PANEL_SIZE, PANEL_THICKNESS, PANEL_SIZE]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={occupied ? 0.55 : 0.12}
        roughness={0.45}
        metalness={0.2}
      />
    </mesh>
  );
}

function ArenaGrid({ state, playerColor, onPanelClick }) {
  const clickable = state.controlMode === "manual" && state.phase === "fighting";
  return (
    <group>
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        return (
          <Panel
            key={`${col}-${row}`}
            col={col}
            row={row}
            playerHere={state.player.col === col && state.player.row === row}
            enemyHere={state.enemy.col === col && state.enemy.row === row}
            playerColor={playerColor}
            enemyColor={state.enemy.color}
            clickable={clickable}
            onClick={onPanelClick}
          />
        );
      })}
    </group>
  );
}

function CyberspaceRig({ playerColor, enemyColor }) {
  return (
    <>
      <color attach="background" args={["#05050c"]} />
      <fog attach="fog" args={["#05050c", 10, 22]} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#67e8f9", "#1e1020", 0.35]} />
      <directionalLight position={[4, 8, 5]} intensity={0.7} color="#e0f2fe" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[COLS * CELL + 2.5, ROWS * CELL + 3]} />
        <meshStandardMaterial color="#020208" roughness={0.9} />
      </mesh>
      <mesh position={[-4.6, 1.4, -1.2]}>
        <boxGeometry args={[0.12, 3.2, 4.2]} />
        <meshStandardMaterial color="#042f2e" emissive={playerColor} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[4.6, 1.4, -1.2]}>
        <boxGeometry args={[0.12, 3.2, 4.2]} />
        <meshStandardMaterial color="#3f0a12" emissive={enemyColor} emissiveIntensity={0.18} />
      </mesh>
    </>
  );
}

function BattleScene({ state, models, onPanelClick }) {
  const playerColor = models.player.color;
  const fx = useMemo(() => {
    const blasts = state.projectiles.map((p) => ({
      id: p.id,
      col: p.col,
      row: p.row,
      color: p.color,
      kind: "blast",
    }));
    const slashes = state.slashes.map((s) => ({
      id: s.id,
      col: s.col,
      row: s.row,
      color: s.color,
      kind: "slash",
    }));
    return blasts.concat(slashes);
  }, [state.projectiles, state.slashes]);

  return (
    <>
      <CyberspaceRig playerColor={playerColor} enemyColor={state.enemy.color} />
      <ArenaGrid state={state} playerColor={playerColor} onPanelClick={onPanelClick} />
      <SerenityFigure
        model={models.player}
        col={state.player.col}
        row={state.player.row}
        flinch={state.player.flinch}
        hpRatio={state.player.maxHp > 0 ? state.player.hp / state.player.maxHp : 1}
        facing={1}
      />
      <VirusFigure
        model={models.enemy}
        col={state.enemy.col}
        row={state.enemy.row}
        flinch={state.enemy.flinch}
        hpRatio={state.enemy.maxHp > 0 ? state.enemy.hp / state.enemy.maxHp : 1}
      />
      {fx.map((f) => (
        <BattleProjectile key={f.id} col={f.col} row={f.row} color={f.color} kind={f.kind} />
      ))}
    </>
  );
}

export default function NetBattleScene3D({ state, models, onPanelClick }) {
  return (
    <Canvas
      camera={{ position: [0, 5.6, 7.4], fov: 36, near: 0.1, far: 40 }}
      gl={{ alpha: false, antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 1.5]}
      style={{ width: "100%", height: "100%", display: "block", background: "#05050c" }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0.35, 0);
      }}
    >
      <BattleScene state={state} models={models} onPanelClick={onPanelClick} />
    </Canvas>
  );
}

export function BattleNaviPreviewCanvas({ model }) {
  return (
    <Canvas
      camera={{ position: [0.35, 1.35, 2.15], fov: 38 }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 1.5]}
      style={{ width: "100%", height: "100%", background: "transparent" }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 0.7, 0);
      }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 3, 2]} intensity={0.8} />
      <pointLight position={[-1, 2, 1]} intensity={0.6} color={model?.accent || "#fde68a"} />
      <SerenityFigure model={model} anchored hpRatio={1} facing={1} />
    </Canvas>
  );
}
