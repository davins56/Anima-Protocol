import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor, Sparkles, Stars } from "@react-three/drei";
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { COLS, ROWS } from "@/lib/netBattle";
import { CELL, PANEL_SIZE, PANEL_THICKNESS, panelWorldPosition } from "@/lib/battleLayout";
import {
  BattleProjectile,
  SerenityFigure,
  VirusFigure,
} from "./BattleFigures3D";
import TesseractLattice from "./TesseractLattice";
import { useRendererQuality } from "@/hooks/useRendererQuality";

function Panel({ col, row, playerHere, enemyHere, playerColor, enemyColor, onClick, clickable, quality }) {
  const [x, y, z] = panelWorldPosition(col, row);
  const playerSide = col <= 2;
  const occupied = playerHere || enemyHere;
  const color = playerHere
    ? playerColor
    : enemyHere
      ? enemyColor
      : playerSide
        ? "#061820"
        : "#1a070c";
  const emissive = occupied ? (playerHere ? playerColor : enemyColor) : playerSide ? "#155e75" : "#7f1d1d";
  const echo = useRef(null);

  useFrame((state) => {
    if (!echo.current) return;
    const t = state.clock.elapsedTime;
    const pulse = occupied ? 0.55 + Math.sin(t * 4.2) * 0.2 : 0.12 + Math.sin(t * 1.1 + col + row) * 0.04;
    echo.current.material.opacity = pulse;
    echo.current.position.y = PANEL_THICKNESS * 0.5 + (occupied ? 0.045 : 0.02);
  });

  return (
    <group position={[x, y, z]}>
      <mesh
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
        <meshPhysicalMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={occupied ? 0.75 : 0.16}
          roughness={0.18}
          metalness={0.35}
          transmission={quality.transmission}
          thickness={0.35}
          transparent
          opacity={0.92}
        />
      </mesh>
      <mesh ref={echo} position={[0, PANEL_THICKNESS * 0.5 + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PANEL_SIZE * 0.28, PANEL_SIZE * 0.48, 24]} />
        <meshBasicMaterial
          color={occupied ? (playerHere ? playerColor : enemyColor) : emissive}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function ArenaGrid({ state, playerColor, onPanelClick, quality }) {
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
            quality={quality}
          />
        );
      })}
    </group>
  );
}

function HyperspaceRig({ playerColor, enemyColor, quality }) {
  return (
    <>
      <color attach="background" args={["#02010a"]} />
      <fog attach="fog" args={["#02010a", 9, 24]} />
      <ambientLight intensity={0.16} />
      <hemisphereLight args={["#67e8f9", "#1e1020", 0.42]} />
      <directionalLight position={[4, 9, 5]} intensity={0.95} color="#e0f2fe" />
      <directionalLight position={[-5, 3, -2]} intensity={0.35} color={playerColor} />
      <pointLight position={[0, 3.2, 0]} intensity={0.55} color="#c4b5fd" distance={12} />
      <Stars radius={42} depth={26} count={quality.stars} factor={2.8} saturation={0.15} fade speed={0.7} />
      {quality.sparkles > 0 ? (
        <>
          <Sparkles
            count={Math.ceil(quality.sparkles * 0.57)}
            scale={[COLS * CELL + 2, 3.2, ROWS * CELL + 2]}
            size={2.2}
            speed={0.28}
            color={playerColor}
            opacity={0.55}
            position={[0, 1.4, 0]}
          />
          <Sparkles
            count={Math.floor(quality.sparkles * 0.43)}
            scale={[COLS * CELL + 1.5, 2.6, ROWS * CELL + 1.5]}
            size={1.6}
            speed={0.42}
            color={enemyColor}
            opacity={0.4}
            position={[1.4, 1.1, 0]}
          />
        </>
      ) : null}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[COLS * CELL + 3.2, ROWS * CELL + 3.6]} />
        <meshStandardMaterial color="#010108" roughness={0.92} metalness={0.08} />
      </mesh>
      <mesh position={[-4.8, 1.55, -1.1]}>
        <boxGeometry args={[0.08, 3.6, 4.6]} />
        <meshPhysicalMaterial
          color="#042f2e"
          emissive={playerColor}
          emissiveIntensity={0.28}
          transmission={quality.transmission}
          roughness={0.2}
          thickness={0.4}
        />
      </mesh>
      <mesh position={[4.8, 1.55, -1.1]}>
        <boxGeometry args={[0.08, 3.6, 4.6]} />
        <meshPhysicalMaterial
          color="#3f0a12"
          emissive={enemyColor}
          emissiveIntensity={0.28}
          transmission={quality.transmission}
          roughness={0.2}
          thickness={0.4}
        />
      </mesh>
      {quality.tesseracts >= 1 ? (
        <TesseractLattice color={playerColor} scale={3.4} speed={0.32} opacity={0.22} position={[0, 1.6, -0.4]} />
      ) : null}
      {quality.tesseracts >= 2 ? (
        <TesseractLattice color={enemyColor} scale={2.1} speed={0.55} opacity={0.18} position={[0, 2.4, -0.8]} />
      ) : null}
    </>
  );
}

function CinematicCamera({ enabled }) {
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime;
    state.camera.position.x = Math.sin(t * 0.07) * 0.42;
    state.camera.position.y = 5.85 + Math.sin(t * 0.11) * 0.18;
    state.camera.position.z = 7.55 + Math.cos(t * 0.06) * 0.22;
    state.camera.lookAt(0, 0.42, 0);
  });
  return null;
}

function BattleScene({ state, models, onPanelClick, quality }) {
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
      <CinematicCamera enabled={quality.animateCamera} />
      <HyperspaceRig playerColor={playerColor} enemyColor={state.enemy.color} quality={quality} />
      <ArenaGrid state={state} playerColor={playerColor} onPanelClick={onPanelClick} quality={quality} />
      <SerenityFigure
        model={models.player}
        col={state.player.col}
        row={state.player.row}
        flinch={state.player.flinch}
        hpRatio={state.player.maxHp > 0 ? state.player.hp / state.player.maxHp : 1}
        facing={1}
        quality={quality}
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
      {quality.postprocessing ? (
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <Bloom intensity={0.9} luminanceThreshold={0.2} luminanceSmoothing={0.28} mipmapBlur />
          <ChromaticAberration offset={[0.0007, 0.0005]} radialModulation modulationOffset={0.35} />
          <Vignette darkness={0.55} offset={0.28} />
        </EffectComposer>
      ) : null}
    </>
  );
}

export default function NetBattleScene3D({ state, models, onPanelClick }) {
  const { quality, handleDecline, handleIncline } = useRendererQuality();
  return (
    <Canvas
      camera={{ position: [0, 5.85, 7.55], fov: 34, near: 0.1, far: 50 }}
      gl={{ alpha: false, antialias: quality.antialias, powerPreference: "high-performance" }}
      dpr={quality.dpr}
      style={{ width: "100%", height: "100%", display: "block", background: "#02010a" }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0.42, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.16;
      }}
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={handleDecline}
        onIncline={handleIncline}
      >
        <BattleScene
          state={state}
          models={models}
          onPanelClick={onPanelClick}
          quality={quality}
        />
      </PerformanceMonitor>
    </Canvas>
  );
}
