/**
 * R3F view of the cyberworld, styled as an isometric voxel city: every zone
 * is the neon rooftop of a window-lit tower block (./voxel), walkways are
 * chunky sky-bridges, and a diorama camera looks down from a high 45° angle
 * over a purple/orange skyline.
 *
 * Reuse: residents render through BattleFigures3D.SerenityFigure →
 * AnimaVesselMesh fed by each companion's saved vessel (lib/sim/vesselModel),
 * quality tiers via useRendererQuality + PerformanceMonitor, bloom from
 * @react-three/postprocessing exactly like SimArena3D.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef, type MutableRefObject, type RefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { SerenityFigure } from "@/components/battle/BattleFigures3D";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { useRendererQuality } from "@/hooks/useRendererQuality";
import { vesselToBattleModel } from "@/lib/sim/vesselModel";
import { animaStandPoint, isWalkable, nearestAnima, planRoute, resolveMove, stepToward } from "./collision";
import { portalAt } from "./areas";
import { footstepInterval } from "./audio";
import { pathEndpoints, zoneEdgeDistance, type Area, type AreaDecor, type Portal, type Vec2, type WorldAnima, type Zone } from "./layout";
import { NEON, roofZone } from "./voxel/voxel";
import { STREET_Y, VoxelCity } from "./voxel/VoxelCity";
import { nearestTraveller, type Traveller } from "./journey/journeys";
import { FeatureBoundary } from "./gl/FeatureBoundary";
import { clampDpr, GL_TIERS, isIOSLike, type GLTier } from "./gl/glLadder";

/** Night-city palette from the voxel reference: deep indigo sky, violet haze, orange/pink/cyan neon. */
export const SKY = "#0B0820";
const HAZE = "#2A1A55";
const CYAN = NEON.cyan;
const PLAYER_SPEED = 6; // units / second
const PLATFORM_Y = 0;

export type MoveInput = { x: number; z: number };

/** Live player state the scene writes every frame (read by the minimap HUD). */
export type PlayerTelemetry = { x: number; z: number; heading: number; moving: boolean };

export type SceneTint = { accent: string; gridCell: string; gridSection: string; fog: string; light: number };
export type SceneNode = { id: string; position: Vec2; color: string; revealed: boolean; big: boolean };

/** One-shot commands from the HUD into the scene (consumed on the next frame). */
export type SceneCommands = { walkTo: Vec2 | null };

type SceneProps = {
  area: Area;
  /** Where the player appears in this area (spawn or portal arrival). */
  spawn: Vec2;
  animas: readonly WorldAnima[];
  telemetry: MutableRefObject<PlayerTelemetry>;
  commands: MutableRefObject<SceneCommands>;
  onPortal: (portal: Portal) => void;
  onStep?: () => void;
  /** Real-world biome/time tint for the plaza neon, haze and light (exploration). */
  tint?: SceneTint | null;
  /** Data nodes for the exploration loop; only revealed ones render. */
  nodes?: readonly SceneNode[];
  /** performance.now() of the last Scan, drives the scan pulse ring. */
  scanPulseAt?: number;
  /** Anima walking with the player (hidden from their homepage meanwhile). */
  companion?: WorldAnima | null;
  /** Live journey state (positions per frame); when absent residents stay home. */
  travellers?: MutableRefObject<Traveller[]>;
  /** Current thought bubble per resident id. */
  thoughts?: Record<string, string | null>;
  /** Data Bazaar cosmetics: visor tint and an optional light trail colour. */
  playerStyle?: { visor?: string; trail?: string };
  /** WebGL tier to create the context with (see gl/glLadder); defaults to the first tier. */
  glTier?: GLTier;
  /** Context lost and not restored: the host remounts on the next tier. */
  onGLLost?: (reason: string) => void;
  /** Live on-screen joystick / d-pad vector, camera-relative (x right, z forward). */
  touchMove: MutableRefObject<MoveInput>;
  nearAnimaId: string | null;
  onNearChange: (animaId: string | null) => void;
};

type Quality = ReturnType<typeof useRendererQuality>["quality"];

/* ── Voxel helpers ────────────────────────────────────────────────────── */

/** A single box; `glow` boxes are unlit neon (bloom picks them up). */
/** One shared unit cube for every small voxel prop (scaled per mesh). */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function Vox({ p, s, color, glow, opacity }: { p: [number, number, number]; s: [number, number, number]; color: string; glow?: boolean; opacity?: number }) {
  return (
    <mesh position={p} scale={s} geometry={UNIT_BOX}>
      {glow ? (
        <meshBasicMaterial color={color} toneMapped={false} transparent={opacity != null} opacity={opacity ?? 1} depthWrite={opacity == null} />
      ) : (
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
      )}
    </mesh>
  );
}

/* ── World pieces ─────────────────────────────────────────────────────── */

/** Walk-in gate to another area: a chunky voxel frame with a glowing pane and a pulsing pad. */
function PortalGate({ portal }: { portal: Portal }) {
  const pane = useRef<THREE.Mesh>(null);
  const pad = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const k = 0.5 + Math.sin(clock.elapsedTime * 3) * 0.5;
    if (pane.current) (pane.current.material as THREE.MeshBasicMaterial).opacity = 0.22 + k * 0.2;
    if (pad.current) (pad.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + k * 0.4;
  });
  const [x, z] = portal.position;
  const r = portal.radius;
  // Face the gate toward the area origin so it reads from the default camera.
  const yaw = Math.atan2(-x, -z);
  const w = r * 2 + 0.6;
  const h = r * 2 + 1.2;
  return (
    <group position={[x, PLATFORM_Y, z]}>
      <group rotation={[0, yaw, 0]}>
        {[-1, 1].map((sd) => (
          <group key={sd}>
            <Vox p={[(sd * w) / 2, h / 2, 0]} s={[0.35, h, 0.35]} color="#241C46" />
            <Vox p={[(sd * w) / 2 - sd * 0.19, h / 2, 0]} s={[0.05, h * 0.9, 0.37]} color={portal.color} glow />
          </group>
        ))}
        <Vox p={[0, h + 0.17, 0]} s={[w + 0.35, 0.35, 0.35]} color="#241C46" />
        <Vox p={[0, h - 0.03, 0]} s={[w - 0.3, 0.06, 0.37]} color={portal.color} glow />
        <mesh ref={pane} position={[0, h / 2, 0]}>
          <boxGeometry args={[w - 0.35, h - 0.1, 0.04]} />
          <meshBasicMaterial color={portal.color} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <mesh ref={pad} position={[0, 0.02, 0]}>
        <boxGeometry args={[r * 2, 0.03, r * 2]} />
        <meshBasicMaterial color={portal.color} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
      <NameTag text={`→ ${portal.label}`} color={portal.color} position={[0, h + 1.1, 0]} bright />
    </group>
  );
}

/** Generic data-driven set dressing (see AreaDecor): billboards and voxel screen slabs. */
function Decor({ item }: { item: AreaDecor }) {
  if (item.kind === "spot") {
    if (item.prop !== "sofa") return null;
    const [x, , z] = item.position;
    // Small voxel sofa beside the spot (companions rest here on journeys).
    return (
      <group position={[x, 0, z - 0.9]}>
        <Vox p={[0, 0.2, 0]} s={[1.4, 0.4, 0.6]} color="#4B3A78" />
        <Vox p={[0, 0.5, -0.24]} s={[1.4, 0.4, 0.14]} color="#4B3A78" />
        <Vox p={[0, 0.015, 0]} s={[1.6, 0.02, 0.8]} color={NEON.violet} glow opacity={0.5} />
      </group>
    );
  }
  if (item.kind === "prop") return <MarketProp item={item} />;
  if (item.kind === "billboard") {
    return <NameTag text={item.text} color={item.color} position={[...item.position]} bright height={item.height} />;
  }
  const [w, h] = item.size;
  const lines = item.lines ?? 0;
  return (
    <group position={[...item.position]} rotation={[0, item.yaw ?? 0, 0]}>
      <Vox p={[0, 0, -0.08]} s={[w + 0.2, h + 0.2, 0.14]} color="#1A1530" />
      <Vox p={[0, 0, 0]} s={[w, h, 0.03]} color={item.color} glow opacity={0.22} />
      <Vox p={[0, h / 2 + 0.05, 0.01]} s={[w + 0.2, 0.08, 0.06]} color={item.color} glow />
      {Array.from({ length: lines }, (_, i) => (
        <Vox key={i} p={[-w * 0.08, h * 0.3 - (i * h * 0.6) / Math.max(1, lines - 1), 0.03]} s={[w * (0.7 - i * 0.12), h * 0.08, 0.02]} color={item.color} glow />
      ))}
    </group>
  );
}

/** Data Bazaar furniture, built from a few voxels each (see market/area). */
function MarketProp({ item }: { item: Extract<AreaDecor, { kind: "prop" }> }) {
  const board = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (board.current) board.current.position.y = item.position[1] + Math.sin(clock.elapsedTime * 1.1 + item.position[0]) * 0.08;
  });
  const c = item.color;
  const dark = "#241C46";
  const body = (() => {
    switch (item.prop) {
      case "stall":
        return (
          <>
            <Vox p={[0, 0.45, 0]} s={[2.4, 0.9, 0.9]} color={dark} />
            <Vox p={[0, 0.5, 0.46]} s={[2.2, 0.08, 0.02]} color={c} glow />
            {[-1.15, 1.15].map((x) => (
              <Vox key={x} p={[x, 1.25, -0.35]} s={[0.12, 2.5, 0.12]} color={dark} />
            ))}
            <Vox p={[0, 2.5, 0]} s={[2.7, 0.14, 1.4]} color={c} />
            <Vox p={[0, 2.42, 0.71]} s={[2.7, 0.06, 0.04]} color={c} glow />
            {[-0.7, 0, 0.7].map((x, i) => (
              <Vox key={x} p={[x, 1.05, 0]} s={[0.3, 0.3, 0.3]} color={i === 1 ? "#FFFFFF" : c} glow opacity={0.85} />
            ))}
          </>
        );
      case "kiosk":
        return (
          <>
            <Vox p={[0, 0.5, 0]} s={[1.6, 1, 1.6]} color={dark} />
            <Vox p={[0, 1.02, 0]} s={[1.7, 0.06, 1.7]} color={c} glow />
            <Vox p={[0, 1.7, 0]} s={[0.12, 1.4, 0.12]} color={dark} />
            <Vox p={[0, 2.45, 0]} s={[2.6, 0.14, 2.6]} color={c} />
            {[[-1.4, 0.6], [1.4, 0.6], [0, 1.5]].map(([x, z]) => (
              <Vox key={`${x}${z}`} p={[x, 0.25, z]} s={[0.45, 0.5, 0.45]} color="#4B3A78" />
            ))}
            <Vox p={[0.3, 1.18, 0.2]} s={[0.22, 0.26, 0.22]} color="#FFFFFF" glow />
          </>
        );
      case "terminal":
        return (
          <>
            <Vox p={[0, 0.75, 0]} s={[0.8, 1.5, 0.55]} color={dark} />
            <Vox p={[0, 1.15, 0.29]} s={[0.62, 0.5, 0.02]} color={c} glow opacity={0.85} />
            <Vox p={[0, 1.65, 0]} s={[0.9, 0.08, 0.65]} color={c} glow />
            <Vox p={[0, 0.02, 0.6]} s={[1.8, 0.03, 1.4]} color={c} glow opacity={0.35} />
          </>
        );
      case "crates":
        return (
          <>
            <Vox p={[0, 0.35, 0]} s={[0.7, 0.7, 0.7]} color="#3B2F5C" />
            <Vox p={[0.75, 0.3, 0.1]} s={[0.6, 0.6, 0.6]} color="#2E2650" />
            <Vox p={[0.3, 0.95, 0]} s={[0.5, 0.5, 0.5]} color="#3B2F5C" />
            <Vox p={[0, 0.35, 0.36]} s={[0.5, 0.06, 0.02]} color={c} glow />
            <Vox p={[0.3, 0.95, 0.26]} s={[0.34, 0.05, 0.02]} color={c} glow />
          </>
        );
      case "priceboard":
        return (
          <group ref={board}>
            <Vox p={[0, 0, 0]} s={[2.4, 1.3, 0.03]} color={c} glow opacity={0.22} />
            <Vox p={[0, 0.7, 0]} s={[2.5, 0.07, 0.05]} color={c} glow />
            {[0, 1, 2, 3].map((i) => (
              <group key={i}>
                <Vox p={[-0.55, 0.38 - i * 0.26, 0.02]} s={[1.0, 0.1, 0.02]} color={c} glow />
                <Vox p={[0.75, 0.38 - i * 0.26, 0.02]} s={[0.4, 0.1, 0.02]} color={i % 2 ? "#7CFFB2" : "#FF4FA3"} glow />
              </group>
            ))}
          </group>
        );
    }
  })();
  if (item.prop === "priceboard") {
    return <group position={[item.position[0], 0, item.position[2]]} rotation={[0, item.yaw ?? 0, 0]}>{body}</group>;
  }
  return (
    <group position={[...item.position]} rotation={[0, item.yaw ?? 0, 0]}>
      {body}
      {item.label && <NameTag text={item.label} color={c} position={[0, item.prop === "terminal" ? 2.2 : 3, 0]} bright />}
    </group>
  );
}

/** Plaza centrepiece: a floating voxel data core over a light beam (kept above head height so routes through the centre stay clear). */
function HubCore({ color }: { color: string }) {
  const core = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    if (!core.current) return;
    core.current.rotation.y += dt * 0.5;
    core.current.position.y = 3.4 + Math.sin(clock.elapsedTime * 1.2) * 0.12;
  });
  const cubes = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (Math.abs(x) + Math.abs(y) + Math.abs(z) <= 1) out.push([x * 0.42, y * 0.42, z * 0.42]);
    return out;
  }, []);
  return (
    <group>
      <group ref={core} position={[0, 3.4, 0]}>
        {cubes.map((p, i) => (
          <Vox key={i} p={p} s={[0.4, 0.4, 0.4]} color={i === 0 ? "#FFFFFF" : color} glow />
        ))}
        <mesh scale={1.9}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.45} toneMapped={false} />
        </mesh>
      </group>
      <Vox p={[0, 2.4, 0]} s={[0.08, 1.6, 0.08]} color={color} glow opacity={0.5} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <HoloScreen key={i} angle={(i / 6) * Math.PI * 2 + Math.PI / 6} radius={4.4} y={2.5} color={i % 2 ? NEON.violet : i === 2 ? NEON.orange : color} />
      ))}
    </group>
  );
}

function HoloScreen({ angle, radius, y, color }: { angle: number; radius: number; y: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = y + Math.sin(clock.elapsedTime * 1.3 + angle * 3) * 0.12;
  });
  return (
    <group ref={ref} position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius]} rotation={[0, -angle + Math.PI / 2, 0]}>
      <Vox p={[0, 0, 0]} s={[1.4, 0.8, 0.04]} color={color} glow opacity={0.18} />
      {[0.22, 0.05, -0.12].map((ly, i) => (
        <Vox key={ly} p={[-0.25 + i * 0.08, ly, 0.03]} s={[0.8 - i * 0.2, 0.07, 0.02]} color={color} glow />
      ))}
      <Vox p={[0, -0.44, 0]} s={[1.5, 0.08, 0.08]} color={color} glow />
    </group>
  );
}

/** Homepage sign: two voxel posts and a neon lintel at the outer rim, behind the resident. */
function HomeSign({ zone }: { zone: Zone }) {
  const len = Math.hypot(zone.center[0], zone.center[1]) || 1;
  const out: Vec2 = [zone.center[0] / len, zone.center[1] / len];
  const d = zone.radius * 0.82;
  const yaw = Math.atan2(out[0], out[1]);
  return (
    <group position={[zone.center[0] + out[0] * d, 0, zone.center[1] + out[1] * d]} rotation={[0, yaw, 0]}>
      {[-1.3, 1.3].map((px) => (
        <Vox key={px} p={[px, 1.2, 0]} s={[0.3, 2.4, 0.3]} color="#241C46" />
      ))}
      <Vox p={[0, 2.5, 0]} s={[2.9, 0.3, 0.3]} color="#241C46" />
      <Vox p={[0, 2.5, 0.16]} s={[2.6, 0.12, 0.02]} color={zone.color} glow />
      <Vox p={[0, 1.2, 0]} s={[2.3, 2.2, 0.04]} color={zone.color} glow opacity={0.1} />
      {[-1.3, 1.3].map((px) => (
        <Vox key={`l${px}`} p={[px, 1.2, 0.16]} s={[0.06, 2.2, 0.02]} color={zone.color} glow />
      ))}
    </group>
  );
}

/** Sky-bridge between rooftops: thick deck, posts, neon rails and data pulses. */
function Walkway({ a, b, width, color, onFloorClick }: { a: Vec2; b: Vec2; width: number; color: string; onFloorClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const pulses = useRef<THREE.Group>(null);
  const count = Math.max(2, Math.round(length / 4));
  const posts = Math.max(2, Math.floor(length / 1.5));
  useFrame(({ clock }) => {
    const g = pulses.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      const t = (clock.elapsedTime * 0.25 + i / count) % 1;
      child.position.z = (t - 0.5) * length;
    });
  });
  return (
    <group position={[(a[0] + b[0]) / 2, PLATFORM_Y, (a[1] + b[1]) / 2]} rotation={[0, yaw, 0]}>
      <mesh position={[0, -0.3, 0]} onClick={onFloorClick}>
        <boxGeometry args={[width + 0.3, 0.6, length]} />
        <meshStandardMaterial color="#2A2250" roughness={0.75} />
      </mesh>
      {/* Under-truss so bridges read as solid voxel spans from the high camera. */}
      <Vox p={[0, -0.85, 0]} s={[width * 0.5, 0.5, length]} color="#151028" />
      {[-1, 1].map((s) => (
        <group key={s}>
          {Array.from({ length: posts }, (_, i) => (
            <Vox key={i} p={[(s * (width + 0.2)) / 2, 0.2, -length / 2 + ((i + 0.5) * length) / posts]} s={[0.14, 0.4, 0.14]} color="#241C46" />
          ))}
          <Vox p={[(s * (width + 0.2)) / 2, 0.43, 0]} s={[0.1, 0.06, length]} color={color} glow />
        </group>
      ))}
      <group ref={pulses}>
        {Array.from({ length: count }, (_, i) => (
          <mesh key={i} position={[0, 0.02, 0]}>
            <boxGeometry args={[width * 0.45, 0.03, 0.45]} />
            <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Visually start/stop a walkway at the rooftop rims (collision still uses centre-to-centre). */
function trimToEdges(a: Vec2, b: Vec2, za: Zone | undefined, zb: Zone | undefined): [Vec2, Vec2] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const ra = za ? zoneEdgeDistance(roofZone(za), ux, uz) - 0.6 : 0;
  const rb = zb ? zoneEdgeDistance(roofZone(zb), -ux, -uz) - 0.6 : 0;
  return [
    [a[0] + ux * Math.max(0, ra), a[1] + uz * Math.max(0, ra)],
    [b[0] - ux * Math.max(0, rb), b[1] - uz * Math.max(0, rb)],
  ];
}

/**
 * Billboarded pixel-font nameplate drawn to a small CanvasTexture and scaled
 * up with nearest filtering, so labels look like the voxel signage. No DOM
 * overlay roots and no font download, so it works offline too.
 */
function NameTag({ text, color, position, bright, height = 0.46, upper = true }: { text: string; color: string; position: [number, number, number]; bright: boolean; height?: number; upper?: boolean }) {
  const { texture, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    const font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const label = upper ? text.toUpperCase() : text;
    let w = 80;
    if (g) {
      g.font = font;
      w = Math.ceil(g.measureText(label).width) + 14;
    }
    c.width = w;
    c.height = 18;
    if (g) {
      g.imageSmoothingEnabled = false;
      g.fillStyle = "rgba(10,7,26,0.9)";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = color;
      // Corner brackets instead of a full frame: reads as a HUD/pixel sign.
      for (const [x, y, ww, hh] of [[0, 0, 4, 1], [0, 0, 1, 4], [w - 4, 0, 4, 1], [w - 1, 0, 1, 4], [0, 17, 4, 1], [0, 14, 1, 4], [w - 4, 17, 4, 1], [w - 1, 14, 1, 4]]) g.fillRect(x, y, ww, hh);
      g.font = font;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, c.width / 2, c.height / 2 + 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return { texture: t, aspect: c.width / c.height };
  }, [text, color, upper]);
  useEffect(() => () => texture.dispose(), [texture]);
  const h = height;
  return (
    <sprite position={position} scale={[h * aspect, h, 1]}>
      <spriteMaterial map={texture} transparent opacity={bright ? 1 : 0.85} toneMapped={false} depthWrite={false} />
    </sprite>
  );
}

/* ── Characters ───────────────────────────────────────────────────────── */

/**
 * A resident Anima. With journeys on, its position/heading come from the live
 * traveller state (smoothed per frame) and it only shows in its current area;
 * the stand pad stays on its homepage. A thought bubble shows why it's going
 * somewhere / what it's doing.
 */
function Resident({ home, anima, near, quality, travellers, areaId, thought }: { home: Zone | null; anima: WorldAnima; near: boolean; quality: Quality; travellers?: MutableRefObject<Traveller[]>; areaId: string; thought?: string | null }) {
  const color = home?.color ?? anima.color ?? CYAN;
  const { vessel } = useCharacterVessel(anima.mock ? null : anima.id);
  const model = useMemo(() => {
    const m = vesselToBattleModel(vessel?.config, anima.name);
    return vessel ? m : { ...m, color };
  }, [vessel, anima.name, color]);
  const body = useRef<THREE.Group>(null);
  const turn = useRef<THREE.Group>(null);
  const ready = useRef(false);
  const stand = home ? animaStandPoint(home) : null;
  useFrame((_, dt) => {
    const g = body.current;
    if (!g) return;
    const t = travellers?.current.find((x) => x.id === anima.id);
    if (!t) {
      g.visible = !!stand;
      if (stand) g.position.set(stand[0], PLATFORM_Y, stand[1]);
      return;
    }
    g.visible = t.areaId === areaId;
    if (!g.visible) {
      ready.current = false;
      return;
    }
    if (!ready.current) {
      g.position.set(t.pos[0], PLATFORM_Y, t.pos[1]);
      ready.current = true;
    }
    // Sim ticks at 4 Hz; ease toward it so motion reads smooth.
    const k = 1 - Math.pow(0.004, dt);
    g.position.x += (t.pos[0] - g.position.x) * k;
    g.position.z += (t.pos[1] - g.position.z) * k;
    if (turn.current) {
      const cur = turn.current.rotation.y;
      const d = Math.atan2(Math.sin(t.heading - cur), Math.cos(t.heading - cur));
      turn.current.rotation.y = cur + d * Math.min(1, dt * 6);
    }
  });
  const yaw0 = stand ? Math.atan2(-stand[0], -stand[1]) : 0;
  return (
    <>
      {stand && (
        <group position={[stand[0], PLATFORM_Y, stand[1]]}>
          {/* Voxel stand pad (their spot at home). */}
          <Vox p={[0, 0.06, 0]} s={[1.6, 0.12, 1.6]} color="#2E2560" />
          <Vox p={[0, 0.125, 0]} s={[1.5, 0.02, 1.5]} color={color} glow opacity={near ? 0.9 : 0.4} />
        </group>
      )}
      <group ref={body} position={stand ? [stand[0], PLATFORM_Y, stand[1]] : [0, -100, 0]}>
        <group ref={turn} rotation={[0, yaw0, 0]} scale={1.25}>
          {/* Own boundary so a resident's GLTF/face texture loading never re-suspends the world. */}
          <Suspense fallback={null}>
            <FeatureBoundary name={`figure for ${anima.name}`}>
              <SerenityFigure model={model} anchored quality={quality} expression={near ? 0.6 : 0.15} />
            </FeatureBoundary>
          </Suspense>
        </group>
        <NameTag text={home?.label ?? `${anima.name}.EXE`} color={color} position={[0, 2.75, 0]} bright={near} height={0.55} />
        {thought && (
          <FeatureBoundary name="thought text">
            <NameTag text={thought.length > 60 ? `${thought.slice(0, 57)}…` : thought} color="#F1F5F9" position={[0, 3.4, 0]} bright height={0.36} upper={false} />
          </FeatureBoundary>
        )}
      </group>
    </>
  );
}

/** The player's own navi: a little voxel figure in protocol blue, faces its walk direction. */
function PlayerNavi({ group, visor = CYAN }: { group: RefObject<THREE.Group | null>; visor?: string }) {
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (body.current) body.current.position.y = Math.abs(Math.sin(clock.elapsedTime * 3)) * 0.06;
  });
  return (
    <group ref={group}>
      <group ref={body}>
        {[-0.15, 0.15].map((x) => (
          <Vox key={x} p={[x, 0.3, 0]} s={[0.22, 0.6, 0.26]} color="#0B2F6B" />
        ))}
        <Vox p={[0, 0.92, 0]} s={[0.62, 0.66, 0.4]} color="#1D4ED8" />
        {[-0.4, 0.4].map((x) => (
          <Vox key={`a${x}`} p={[x, 0.9, 0]} s={[0.18, 0.56, 0.22]} color="#1E40AF" />
        ))}
        <Vox p={[0, 1.5, 0]} s={[0.56, 0.5, 0.5]} color="#1E3A8A" />
        <Vox p={[0, 1.52, 0.26]} s={[0.46, 0.12, 0.04]} color={visor} glow />
        <Vox p={[0, 0.95, 0.21]} s={[0.16, 0.16, 0.04]} color="#FACC15" glow />
        <Vox p={[0, 1.8, 0]} s={[0.12, 0.14, 0.12]} color={CYAN} glow />
      </group>
      <Vox p={[0, 0.015, 0]} s={[0.9, 0.02, 0.9]} color={CYAN} glow opacity={0.3} />
    </group>
  );
}

const TRAIL_LEN = 8;

/** Neon Trail cosmetic: fading light cubes dropped behind the player while walking. */
function PlayerTrail({ group, color }: { group: RefObject<THREE.Group | null>; color: string }) {
  const cubes = useRef<(THREE.Mesh | null)[]>([]);
  const pts = useRef<THREE.Vector3[]>([]);
  const acc = useRef(0);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    acc.current += dt;
    const last = pts.current[0];
    if (acc.current > 0.07) {
      acc.current = 0;
      if (!last || last.distanceToSquared(g.position) > 0.04) pts.current.unshift(g.position.clone());
      else pts.current.pop();
      if (pts.current.length > TRAIL_LEN) pts.current.length = TRAIL_LEN;
    }
    cubes.current.forEach((m, i) => {
      if (!m) return;
      const p = pts.current[i + 1];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p.x, p.y + 0.25, p.z);
      m.scale.setScalar(0.24 * (1 - i / TRAIL_LEN));
    });
  });
  return (
    <>
      {Array.from({ length: TRAIL_LEN }, (_, i) => (
        <mesh key={i} ref={(m) => { cubes.current[i] = m; }} geometry={UNIT_BOX} visible={false}>
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.75 - i * 0.08} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/* ── Exploration ──────────────────────────────────────────────────────── */

/** Data node: a spinning voxel diamond with an orbiting bit, a beam and a floor pad. */
function DataNodeMesh({ node }: { node: SceneNode }) {
  const g = useRef<THREE.Group>(null);
  const appear = useRef(0);
  useFrame(({ clock }, dt) => {
    const el = g.current;
    if (!el) return;
    appear.current = Math.min(1, appear.current + dt * 2.5);
    const t = clock.elapsedTime + node.position[0];
    el.rotation.y += dt * 1.4;
    el.position.y = 0.95 + Math.sin(t * 2) * 0.12;
    el.scale.setScalar(appear.current * (node.big ? 1.35 : 1));
  });
  return (
    <group position={[node.position[0], 0, node.position[1]]}>
      <group ref={g} scale={0}>
        <group rotation={[Math.PI / 4, 0, Math.PI / 4]}>
          <Vox p={[0, 0, 0]} s={[0.34, 0.34, 0.34]} color={node.color} glow />
        </group>
        <Vox p={[0.45, 0.15, 0]} s={[0.1, 0.1, 0.1]} color="#FFFFFF" glow />
        <mesh scale={0.62}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={node.color} wireframe transparent opacity={0.5} toneMapped={false} />
        </mesh>
      </group>
      <Vox p={[0, 1.8, 0]} s={[0.05, 3.6, 0.05]} color={node.color} glow opacity={0.35} />
      <Vox p={[0, 0.015, 0]} s={[0.8, 0.02, 0.8]} color={node.color} glow opacity={0.7} />
    </group>
  );
}

const SCAN_PULSE_MS = 1100;

/** Expanding ring from the player after a Scan. */
function ScanPulse({ at, telemetry, color }: { at: number; telemetry: MutableRefObject<PlayerTelemetry>; color: string }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ring.current;
    if (!m) return;
    const k = (performance.now() - at) / SCAN_PULSE_MS;
    m.visible = at > 0 && k >= 0 && k < 1;
    if (!m.visible) return;
    m.position.set(telemetry.current.x, 0.08, telemetry.current.z);
    m.scale.setScalar(0.5 + k * 9);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
  });
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, Math.PI / 4]} visible={false}>
      {/* 4 segments = a square sonar ring, in keeping with the voxel grid. */}
      <ringGeometry args={[0.92, 1, 4]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/** Accompanying Anima: trails behind the player's shoulder. */
function Follower({ anima, telemetry, quality }: { anima: WorldAnima; telemetry: MutableRefObject<PlayerTelemetry>; quality: Quality }) {
  const g = useRef<THREE.Group>(null);
  const { vessel } = useCharacterVessel(anima.mock ? null : anima.id);
  const model = useMemo(() => {
    const m = vesselToBattleModel(vessel?.config, anima.name);
    return vessel ? m : { ...m, color: anima.color || "#00EAFF" };
  }, [vessel, anima.name, anima.color]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const ready = useRef(false);
  useFrame((_, dt) => {
    const el = g.current;
    if (!el) return;
    const t = telemetry.current;
    // Behind-left of the player, relative to their heading.
    const h = t.heading;
    target.set(t.x - Math.sin(h) * 1.3 - Math.cos(h) * 0.9, 0, t.z - Math.cos(h) * 1.3 + Math.sin(h) * 0.9);
    if (!ready.current) {
      el.position.copy(target);
      ready.current = true;
    }
    el.position.lerp(target, 1 - Math.pow(0.02, dt));
    el.rotation.y = h;
  });
  return (
    <group ref={g}>
      <group scale={0.95}>
        <Suspense fallback={null}>
          <FeatureBoundary name="companion figure">
            <SerenityFigure model={model} anchored quality={quality} expression={0.4} />
          </FeatureBoundary>
        </Suspense>
      </group>
      <NameTag text={anima.name} color={model.color} position={[0, 2.1, 0]} bright={false} height={0.32} />
    </group>
  );
}

/* ── Controller ───────────────────────────────────────────────────────── */

const KEY_DIRS: Record<string, MoveInput> = {
  KeyW: { x: 0, z: 1 },
  ArrowUp: { x: 0, z: 1 },
  KeyS: { x: 0, z: -1 },
  ArrowDown: { x: 0, z: -1 },
  KeyA: { x: -1, z: 0 },
  ArrowLeft: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 },
  ArrowRight: { x: 1, z: 0 },
};

function useHeldKeys() {
  const held = useRef(new Set<string>());
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (!KEY_DIRS[e.code] || isTyping(e)) return;
      held.current.add(e.code);
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => held.current.delete(e.code);
    const clear = () => held.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return held;
}


/** Diorama camera: high, 45° off-axis, narrow FOV so the city reads near-isometric. */
const CAMERA_OFFSET: readonly [number, number, number] = [17, 22, 17];
const CAMERA_FOV = 34;

const SKYLINE_COUNT: Record<string, number> = { low: 60, medium: 120, high: 170 };

function World({ area, spawn, animas, touchMove, telemetry, commands, onPortal, onStep, nearAnimaId, onNearChange, quality, tint, nodes, scanPulseAt = 0, companion, travellers, thoughts, playerStyle, glTier }: SceneProps & { quality: Quality }) {
  const player = useRef<THREE.Group>(null);
  const pos = useRef<Vec2>(spawn);
  const route = useRef<Vec2[]>([]);
  const marker = useRef<THREE.Mesh>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const nearId = useRef<string | null>(null);
  // Portals stay disarmed until the player has stepped clear of every gate.
  const armed = useRef(false);
  const stepClock = useRef(0);
  const held = useHeldKeys();
  const { camera } = useThree();
  const zonesById = useMemo(() => new Map(area.zones.map((z) => [z.id, z])), [area]);
  const tmpForward = useMemo(() => new THREE.Vector3(), []);
  const hubAccent = tint?.accent ?? null;
  // The hub plaza takes on the real-world biome tint; homes keep their Anima colours.
  const accentFor = useMemo(() => (z: Zone) => (z.kind === "hub" && hubAccent ? hubAccent : z.color), [hubAccent]);
  const light = tint?.light ?? 1;
  // Night/dusk tints darken the haze a touch; the city keeps its violet glow.
  const haze = useMemo(() => new THREE.Color(HAZE).lerp(new THREE.Color(tint?.fog ?? SKY), 0.35).getStyle(), [tint?.fog]);

  // (Re)spawn: this component is keyed per area visit, so mount = arrival.
  useLayoutEffect(() => {
    pos.current = spawn;
    route.current = [];
    armed.current = !portalAt(area, spawn);
    camera.position.set(spawn[0] + CAMERA_OFFSET[0], CAMERA_OFFSET[1], spawn[1] + CAMERA_OFFSET[2]);
    camera.lookAt(spawn[0], 1, spawn[1]);
    telemetry.current = { x: spawn[0], z: spawn[1], heading: Math.PI, moving: false };
  }, [area, spawn, camera, telemetry]);
  const walkTo = (p: Vec2) => {
    route.current = planRoute(area, pos.current, p);
  };

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    // Ignore the click that ends an orbit drag.
    if (e.delta > 6) return;
    e.stopPropagation();
    const p: Vec2 = [e.point.x, e.point.z];
    if (!isWalkable(area, p, 0.2)) return;
    walkTo(p);
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = player.current;
    if (!g) return;

    if (commands.current.walkTo) {
      walkTo(commands.current.walkTo);
      commands.current.walkTo = null;
    }

    // Camera-relative input: keys + touch d-pad.
    let ix = touchMove.current.x;
    let iz = touchMove.current.z;
    for (const code of held.current) {
      ix += KEY_DIRS[code].x;
      iz += KEY_DIRS[code].z;
    }
    const from = pos.current;
    let next = from;
    const mag = Math.hypot(ix, iz);
    if (mag > 0.05) {
      route.current = [];
      camera.getWorldDirection(tmpForward);
      const fx = tmpForward.x, fz = tmpForward.z;
      const fl = Math.hypot(fx, fz) || 1;
      const f: Vec2 = [fx / fl, fz / fl];
      const r: Vec2 = [-f[1], f[0]];
      const s = (PLAYER_SPEED * dt) / Math.max(1, mag);
      const want: Vec2 = [from[0] + (r[0] * ix + f[0] * iz) * s, from[1] + (r[1] * ix + f[1] * iz) * s];
      next = resolveMove(area, from, want);
    } else if (route.current.length) {
      const step = stepToward(area, from, route.current[0], PLAYER_SPEED * dt);
      next = step.next;
      if (step.done) route.current = route.current.slice(1);
    }

    const mx = next[0] - from[0];
    const mz = next[1] - from[1];
    const moving = mx !== 0 || mz !== 0;
    if (moving) {
      g.rotation.y = Math.atan2(mx, mz);
      // Orbit-follow: drag the camera along with the player.
      camera.position.x += mx;
      camera.position.z += mz;
      stepClock.current += dt;
      const interval = footstepInterval(Math.hypot(mx, mz) / Math.max(dt, 1e-3));
      if (stepClock.current >= interval) {
        stepClock.current = 0;
        onStep?.();
      }
    }
    pos.current = next;
    telemetry.current = { x: next[0], z: next[1], heading: g.rotation.y, moving };
    g.position.set(next[0], PLATFORM_Y, next[1]);
    if (controls.current) {
      controls.current.target.set(next[0], 1, next[1]);
      controls.current.update();
    }
    const dest = route.current[route.current.length - 1];
    if (marker.current) {
      marker.current.visible = !!dest;
      if (dest) marker.current.position.set(dest[0], 0.05, dest[1]);
    }

    const gate = portalAt(area, next);
    if (!gate) armed.current = true;
    else if (armed.current) {
      armed.current = false;
      route.current = [];
      onPortal(gate);
    }

    const id = travellers
      ? (nearestTraveller(travellers.current, area.id, next, 2.6, companion?.id)?.id ?? null)
      : (nearestAnima(area, animas, next)?.anima.id ?? null);
    if (id !== nearId.current) {
      nearId.current = id;
      onNearChange(id);
    }
  });

  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[haze, 40, 130]} />
      <hemisphereLight args={["#8C7CFF", "#FF8A4C", 1.1 * light]} />
      <ambientLight intensity={0.35 * light} color="#8B7BFF" />
      {/* Warm key from one side, cool rim from the other: the orange/violet split of the reference. */}
      <directionalLight position={[-12, 22, 8]} intensity={1.4 * light} color="#FFB27A" />
      <directionalLight position={[14, 10, -12]} intensity={0.55 * light} color="#5CC8FF" />
      <pointLight position={[0, 5, 0]} intensity={28} distance={22} color={hubAccent ?? area.theme.accent} />
      <Stars radius={140} depth={40} count={Math.round(quality.stars * 0.6)} factor={3} fade speed={0.3} />
      {/* Street-level haze floor: hides tower bases so they can stay short. */}
      <mesh position={[0, STREET_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial color={haze} />
      </mesh>

      <VoxelCity area={area} accentFor={accentFor} skylineCount={SKYLINE_COUNT[quality.name] ?? 140} onFloorClick={onFloorClick} />
      {area.paths.map((path) => {
        const ends = pathEndpoints(area, path);
        if (!ends) return null;
        const from = zonesById.get(path.from);
        const to = zonesById.get(path.to);
        const [a, b] = trimToEdges(ends[0], ends[1], from, to);
        return <Walkway key={path.id} a={a} b={b} width={path.width} color={path.color || to?.color || CYAN} onFloorClick={onFloorClick} />;
      })}
      {area.zones.map((zone) =>
        zone.kind === "hub" ? (
          <group key={zone.id} position={[zone.center[0], PLATFORM_Y, zone.center[1]]}>
            <HubCore color={accentFor(zone)} />
          </group>
        ) : zone.kind === "home" ? (
          <HomeSign key={zone.id} zone={zone} />
        ) : null,
      )}
      {animas.map((anima) => {
        if (anima.id === companion?.id) return null;
        const home = area.zones.find((z) => z.animaId === anima.id) ?? null;
        // Without journeys, residents only exist on their homepage.
        if (!travellers && !home) return null;
        return <Resident key={anima.id} home={home} anima={anima} near={anima.id === nearAnimaId} quality={quality} travellers={travellers} areaId={area.id} thought={thoughts?.[anima.id]} />;
      })}
      {area.portals.map((portal) => (
        <PortalGate key={portal.id} portal={portal} />
      ))}
      {area.decor.map((item) => (
        <Decor key={item.id} item={item} />
      ))}

      {nodes?.filter((n) => n.revealed).map((n) => <DataNodeMesh key={n.id} node={n} />)}
      <ScanPulse at={scanPulseAt} telemetry={telemetry} color={tint?.accent ?? area.theme.accent} />
      {companion && <Follower anima={companion} telemetry={telemetry} quality={quality} />}

      <PlayerNavi group={player} visor={playerStyle?.visor} />
      {playerStyle?.trail && (
        <FeatureBoundary name="neon trail">
          <PlayerTrail group={player} color={playerStyle.trail} />
        </FeatureBoundary>
      )}
      <mesh ref={marker} visible={false}>
        <boxGeometry args={[0.6, 0.04, 0.6]} />
        <meshBasicMaterial color="#FACC15" toneMapped={false} />
      </mesh>

      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        minDistance={12}
        maxDistance={50}
        minPolarAngle={0.55}
        maxPolarAngle={1.08}
        enableDamping
        dampingFactor={0.12}
      />

      {quality.postprocessing && (glTier ?? GL_TIERS[0]).bloom && (
        <FeatureBoundary name="bloom">
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <Bloom intensity={1.05} luminanceThreshold={0.32} luminanceSmoothing={0.25} mipmapBlur />
        </EffectComposer>
        </FeatureBoundary>
      )}
    </>
  );
}

/** Create the context ourselves for the chosen tier so a failure names the tier (and the host can step down). */
function createTierRenderer(canvas: HTMLCanvasElement, tier: GLTier): THREE.WebGLRenderer {
  const context = canvas.getContext(tier.context, tier.attributes) as WebGL2RenderingContext | null;
  if (!context) throw new Error(`getContext("${tier.context}") returned null`);
  if (context.isContextLost()) throw new Error("context was lost at creation");
  return new THREE.WebGLRenderer({ canvas, context, ...tier.attributes });
}

/**
 * Keeps the drawing buffer within MAX_RENDERBUFFER_SIZE (and the iOS / tier DPR
 * caps) as the canvas resizes, and handles context loss: preventDefault so the
 * browser may restore it; if it isn't restored soon, ask the host to remount.
 */
function GLGuard({ tier, qualityMax, onLost }: { tier: GLTier; qualityMax: number; onLost?: (reason: string) => void }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const setDpr = useThree((s) => s.setDpr);
  const maxRb = useMemo(() => {
    try {
      return gl.getContext().getParameter(gl.getContext().MAX_RENDERBUFFER_SIZE) as number;
    } catch {
      return null;
    }
  }, [gl]);
  useEffect(() => {
    const dpr = clampDpr({ deviceDpr: window.devicePixelRatio, tier, ios: isIOSLike(navigator), qualityMax, cssW: size.width, cssH: size.height, maxRenderbuffer: maxRb });
    setDpr(dpr);
  }, [size.width, size.height, tier, qualityMax, maxRb, setDpr]);
  const lostCb = useRef(onLost);
  lostCb.current = onLost;
  useEffect(() => {
    const canvas = gl.domElement;
    let t: ReturnType<typeof setTimeout> | null = null;
    const lost = (e: Event) => {
      e.preventDefault();
      if (t) clearTimeout(t);
      t = setTimeout(() => lostCb.current?.("WebGL context lost and not restored"), 2500);
    };
    const restored = () => {
      if (t) clearTimeout(t);
      t = null;
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      if (t) clearTimeout(t);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl]);
  return null;
}

export default function CyberworldScene(props: SceneProps) {
  const { quality, handleDecline, handleIncline } = useRendererQuality();
  const tier = props.glTier ?? GL_TIERS[0];
  const [sx, sz] = props.spawn;
  const qualityMax = (quality.dpr as [number, number])[1];
  // First-frame DPR before GLGuard knows MAX_RENDERBUFFER_SIZE (assumes a conservative 4096).
  const initialDpr = useMemo(
    () => clampDpr({ deviceDpr: typeof window === "undefined" ? 1 : window.devicePixelRatio, tier, ios: typeof navigator !== "undefined" && isIOSLike(navigator), qualityMax, cssW: typeof window === "undefined" ? 1 : window.innerWidth, cssH: typeof window === "undefined" ? 1 : window.innerHeight }),
    [tier, qualityMax],
  );
  return (
    <Canvas
      camera={{ position: [sx + CAMERA_OFFSET[0], CAMERA_OFFSET[1], sz + CAMERA_OFFSET[2]], fov: CAMERA_FOV, near: 0.5, far: 320 }}
      gl={(defaults) => createTierRenderer(defaults.canvas as HTMLCanvasElement, tier)}
      dpr={initialDpr}
      style={{ width: "100%", height: "100%", display: "block", background: SKY, touchAction: "none" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
      }}
    >
      <GLGuard tier={tier} qualityMax={qualityMax} onLost={props.onGLLost} />
      <PerformanceMonitor flipflops={3} onDecline={handleDecline} onIncline={handleIncline}>
        {/* Keyed per visit so arriving through a portal is a clean respawn. */}
        <World key={`${props.area.id}:${props.spawn[0]},${props.spawn[1]}`} {...props} quality={quality} />
      </PerformanceMonitor>
    </Canvas>
  );
}
