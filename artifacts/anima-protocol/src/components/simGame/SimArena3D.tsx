/**
 * The five frequency layers as stacked 6×3 arenas along W. Panels show
 * sim-core terrain (normal / cracked / broken / poison / holy), telegraphed
 * strikes and PhaseGate ends; each layer has a resonance node that is tapped
 * through the layer-masked raycaster (resonancePicker.ts).
 */
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { BANDS, COLS, LAYER_W, PLAYER_MAX_COL, ROWS, type Panel, type PanelKind } from "@workspace/sim-core";
import { CELL, PANEL_SIZE, PANEL_THICKNESS, panelWorldPosition } from "@/lib/battleLayout";
import { wFrame } from "@/lib/simClient/wSpace";
import { markResonanceNode, pickResonanceNode, toNdc } from "./resonancePicker";

export type PanelMarks = {
  /** "col,row" → 0..1 urgency of a telegraphed strike */
  warn: Map<string, number>;
  /** "col,row" cells holding a PhaseGate end */
  portal: Set<string>;
};

const PANEL_LOOK: Record<PanelKind, { color: string; emissive: string; intensity: number }> = {
  normal: { color: "#061820", emissive: "#155e75", intensity: 0.12 },
  cracked: { color: "#1f1a14", emissive: "#a8a29e", intensity: 0.22 },
  broken: { color: "#000000", emissive: "#7f1d1d", intensity: 0.5 },
  poison: { color: "#2e0636", emissive: "#a21caf", intensity: 0.7 },
  holy: { color: "#3b2f06", emissive: "#facc15", intensity: 0.85 },
};

function crackGeometry(col: number, row: number): THREE.BufferGeometry {
  // Deterministic jagged lines per panel.
  let seed = (col * 73856093) ^ (row * 19349663);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pts: number[] = [];
  const h = PANEL_SIZE / 2;
  for (let k = 0; k < 3; k++) {
    let x = (rnd() - 0.5) * 0.2;
    let z = (rnd() - 0.5) * 0.2;
    const a = rnd() * Math.PI * 2;
    for (let i = 0; i < 4; i++) {
      const nx = Math.max(-h, Math.min(h, x + Math.cos(a + (rnd() - 0.5)) * 0.16));
      const nz = Math.max(-h, Math.min(h, z + Math.sin(a + (rnd() - 0.5)) * 0.16));
      pts.push(x, 0, z, nx, 0, nz);
      x = nx;
      z = nz;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

type PanelProps = {
  layer: number;
  col: number;
  row: number;
  kind: PanelKind;
  warn: number;
  portal: boolean;
  active: boolean;
  dim: number;
  bandColor: string;
  onTap: (layer: number, col: number, row: number) => void;
};

const SimPanel = memo(function SimPanel({ layer, col, row, kind, warn, portal, active, dim, bandColor, onTap }: PanelProps) {
  const [x, y, z] = panelWorldPosition(col, row);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const crack = useMemo(() => (kind === "cracked" ? crackGeometry(col, row) : null), [kind, col, row]);
  const playerSide = col <= PLAYER_MAX_COL;
  const look = PANEL_LOOK[kind];
  const base = kind === "normal" ? (playerSide ? "#061820" : "#1a070c") : look.color;
  const emissive = kind === "normal" ? (playerSide ? bandColor : "#7f1d1d") : look.emissive;
  const animated = kind === "poison" || kind === "holy" || warn > 0 || portal;

  useFrame((state) => {
    if (!mat.current || !animated) return;
    const t = state.clock.elapsedTime;
    let i = look.intensity;
    if (kind === "poison") i = 0.45 + Math.sin(t * 3 + col + row) * 0.25;
    if (kind === "holy") i = 0.75 + Math.sin(t * 1.7) * 0.15;
    if (portal) i = Math.max(i, 0.6 + Math.sin(t * 5) * 0.3);
    if (warn > 0) {
      i = Math.max(i, 0.4 + warn * (0.6 + Math.sin(t * (10 + warn * 20)) * 0.5));
      mat.current.emissive.set("#ef4444");
    }
    mat.current.emissiveIntensity = i * (active ? 1 : 0.6);
  });

  const tap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onTap(layer, col, row);
  };

  return (
    <group position={[x, y, z]}>
      {kind === "broken" ? (
        <>
          {[[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dz], i) => (
            <mesh key={i} position={[(dx * PANEL_SIZE) / 2, 0, (dz * PANEL_SIZE) / 2]}>
              <boxGeometry args={[dx ? 0.05 : PANEL_SIZE, PANEL_THICKNESS, dz ? 0.05 : PANEL_SIZE]} />
              <meshStandardMaterial color="#0b0b0b" emissive="#dc2626" emissiveIntensity={0.7 * dim} transparent opacity={dim} toneMapped={false} />
            </mesh>
          ))}
          <mesh position={[0, -0.25, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={tap}>
            <planeGeometry args={[PANEL_SIZE, PANEL_SIZE]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.85 * dim} />
          </mesh>
        </>
      ) : (
        <mesh
          onClick={tap}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[PANEL_SIZE, PANEL_THICKNESS, PANEL_SIZE]} />
          <meshStandardMaterial
            ref={mat}
            color={base}
            emissive={warn > 0 ? "#ef4444" : emissive}
            emissiveIntensity={look.intensity * (active ? 1 : 0.6)}
            roughness={0.25}
            metalness={0.35}
            transparent
            opacity={0.92 * dim}
            depthWrite={dim > 0.6}
          />
        </mesh>
      )}
      {crack ? (
        <lineSegments geometry={crack} position={[0, PANEL_THICKNESS / 2 + 0.004, 0]}>
          <lineBasicMaterial color="#fef3c7" transparent opacity={0.85 * dim} toneMapped={false} />
        </lineSegments>
      ) : null}
      {kind === "holy" ? (
        <mesh position={[0, 0.45, 0]}>
          <cylinderGeometry args={[PANEL_SIZE * 0.42, PANEL_SIZE * 0.48, 0.9, 20, 1, true]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.14 * dim} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
});

/** Glowing node at the arena's left edge; tapping it phase-shifts toward this layer. */
function ResonanceNode({ layer, color, active }: { layer: number; color: string; active: boolean }) {
  const g = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (g.current) markResonanceNode(g.current, layer);
  }, [layer]);
  useFrame((state) => {
    if (!g.current) return;
    const t = state.clock.elapsedTime;
    g.current.rotation.y = t * (active ? 1.2 : 0.5);
    g.current.position.y = 0.9 + Math.sin(t * 1.6 + layer) * 0.08;
  });
  const [x0] = panelWorldPosition(0, 1);
  return (
    <group ref={g} position={[x0 - CELL * 1.15, 0.9, 0]}>
      <mesh>
        <icosahedronGeometry args={[active ? 0.3 : 0.24, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 1.6 : 0.9} toneMapped={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.02, 8, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      {/* generous invisible hit volume for touch */}
      <mesh visible={false}>
        <sphereGeometry args={[0.6, 8, 6]} />
      </mesh>
    </group>
  );
}

function LayerFrame({ color, dim }: { color: string; dim: number }) {
  const geom = useMemo(() => {
    const w = (COLS * CELL) / 2 + 0.15;
    const d = (ROWS * CELL) / 2 + 0.15;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-w, 0, -d, w, 0, -d, w, 0, -d, w, 0, d, w, 0, d, -w, 0, d, -w, 0, d, -w, 0, -d], 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geom} position={[0, -0.02, 0]}>
      <lineBasicMaterial color={color} transparent opacity={0.85 * dim} toneMapped={false} />
    </lineSegments>
  );
}

type LayerProps = {
  layer: number;
  panels: Panel[][];
  marks: PanelMarks;
  activeLayer: number;
  onPanelTap: (layer: number, col: number, row: number) => void;
};

export const SimLayerArena = memo(function SimLayerArena({ layer, panels, marks, activeLayer, onPanelTap }: LayerProps) {
  const band = BANDS[layer];
  const active = layer === activeLayer;
  const dim = active ? 1 : Math.max(0.18, 0.55 - Math.abs(layer - activeLayer) * 0.15);
  const { origin, yaw } = wFrame(LAYER_W[layer]);
  return (
    <group position={origin} rotation={[0, yaw, 0]}>
      <LayerFrame color={band.color} dim={dim} />
      <ResonanceNode layer={layer} color={band.color} active={active} />
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        const key = `${col},${row}`;
        return (
          <SimPanel
            key={key}
            layer={layer}
            col={col}
            row={row}
            kind={panels[row][col].kind}
            warn={marks.warn.get(key) ?? 0}
            portal={marks.portal.has(key)}
            active={active}
            dim={dim}
            bandColor={band.color}
            onTap={onPanelTap}
          />
        );
      })}
    </group>
  );
});

/** DOM pointer → layer-masked raycast against resonance nodes only. */
export function ResonanceTapHandler({ onNode }: { onNode: (layer: number) => void }) {
  const { gl, camera, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const cb = useRef(onNode);
  useLayoutEffect(() => {
    cb.current = onNode;
  }, [onNode]);
  useLayoutEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      const hit = pickResonanceNode(raycaster, camera, toNdc(e.clientX, e.clientY, el.getBoundingClientRect()), scene);
      if (hit) cb.current(hit.layer);
    };
    el.addEventListener("pointerdown", down);
    return () => el.removeEventListener("pointerdown", down);
  }, [gl, camera, scene, raycaster]);
  return null;
}
