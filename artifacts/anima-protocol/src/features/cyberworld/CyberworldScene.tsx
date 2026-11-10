/**
 * R3F view of the cyberworld: neon hex platforms (hub + homepages), glowing
 * data-path walkways, floating panels, the player's navi and resident Animas.
 *
 * Reuse: residents render through BattleFigures3D.SerenityFigure →
 * AnimaVesselMesh fed by each companion's saved vessel (lib/sim/vesselModel),
 * quality tiers via useRendererQuality + PerformanceMonitor, bloom from
 * @react-three/postprocessing exactly like SimArena3D.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef, type MutableRefObject, type RefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, OrbitControls, PerformanceMonitor, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { SerenityFigure } from "@/components/battle/BattleFigures3D";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { useRendererQuality } from "@/hooks/useRendererQuality";
import { vesselToBattleModel } from "@/lib/sim/vesselModel";
import { ANIMA_COLORS } from "@/styles/anima-tokens";
import { animaStandPoint, isWalkable, nearestAnima, planRoute, resolveMove, stepToward } from "./collision";
import { portalAt } from "./areas";
import { footstepInterval } from "./audio";
import { pathEndpoints, zoneEdgeDistance, zoneHalfExtents, zoneShape, type Area, type AreaDecor, type Portal, type Vec2, type WorldAnima, type Zone } from "./layout";

const BG = ANIMA_COLORS["color/bg/canvas"];
const CYAN = ANIMA_COLORS["color/accent/protocol"];
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
  /** Real-world biome/time tint for grid, fog and light (exploration). */
  tint?: SceneTint | null;
  /** Data nodes for the exploration loop; only revealed ones render. */
  nodes?: readonly SceneNode[];
  /** performance.now() of the last Scan, drives the scan pulse ring. */
  scanPulseAt?: number;
  /** Anima walking with the player (hidden from their homepage meanwhile). */
  companion?: WorldAnima | null;
  /** Live on-screen joystick / d-pad vector, camera-relative (x right, z forward). */
  touchMove: MutableRefObject<MoveInput>;
  nearAnimaId: string | null;
  onNearChange: (animaId: string | null) => void;
};

/* ── Materials / textures ─────────────────────────────────────────────── */

function useGridTexture(color: string) {
  return useMemo(() => {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#04121a";
      g.fillRect(0, 0, size, size);
      g.strokeStyle = color;
      g.globalAlpha = 0.85;
      g.lineWidth = 3;
      g.strokeRect(0, 0, size, size);
      g.globalAlpha = 0.3;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(size / 2, 0);
      g.lineTo(size / 2, size);
      g.moveTo(0, size / 2);
      g.lineTo(size, size / 2);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [color]);
}

/* ── World geometry ───────────────────────────────────────────────────── */

function Platform({ zone, onFloorClick }: { zone: Zone; onFloorClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const base = useGridTexture(zone.color);
  const [hx, hz] = zoneHalfExtents(zone);
  const tex = useMemo(() => {
    const t = base.clone();
    t.needsUpdate = true;
    t.repeat.set(hx * 1.2, hz * 1.2);
    return t;
  }, [base, hx, hz]);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(clock.elapsedTime * 2 + zone.center[0]) * 0.25;
  });
  const [x, z] = zone.center;
  if (zoneShape(zone) === "rect") return <RectPlatform zone={zone} tex={tex} onFloorClick={onFloorClick} />;
  // 6 radial segments = hex platform; collision uses the inscribed circle.
  const r = zone.radius / Math.cos(Math.PI / 6);
  return (
    <group position={[x, PLATFORM_Y, z]}>
      <mesh position={[0, -0.25, 0]} rotation={[0, Math.PI / 6, 0]} onClick={onFloorClick}>
        <cylinderGeometry args={[r, r * 0.92, 0.5, 6]} />
        <meshStandardMaterial color="#061923" emissive={zone.color} emissiveMap={tex} emissiveIntensity={0.55} map={tex} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
        <ringGeometry args={[r * 0.94, r, 6]} />
        <meshBasicMaterial color={zone.color} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      {zone.kind === "hub" && <HubCore color={zone.color} />}
      {zone.kind === "home" && <HomeArch zone={zone} />}
    </group>
  );
}

/** Rectangular "page section" platform for site areas. */
function RectPlatform({ zone, tex, onFloorClick }: { zone: Zone; tex: THREE.Texture; onFloorClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const [hx, hz] = zoneHalfExtents(zone);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(hx * 2, hz * 2)), [hx, hz]);
  return (
    <group position={[zone.center[0], PLATFORM_Y, zone.center[1]]}>
      <mesh position={[0, -0.25, 0]} onClick={onFloorClick}>
        <boxGeometry args={[hx * 2, 0.5, hz * 2]} />
        <meshStandardMaterial color="#061923" emissive={zone.color} emissiveMap={tex} emissiveIntensity={0.5} map={tex} roughness={0.6} metalness={0.2} />
      </mesh>
      <lineSegments geometry={edges} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <lineBasicMaterial color={zone.color} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/** Walk-in gate to another area: a standing ring, a swirling floor disc and a label. */
function PortalGate({ portal }: { portal: Portal }) {
  const ring = useRef<THREE.Mesh>(null);
  const disc = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.8;
    if (disc.current) {
      disc.current.rotation.z -= dt * 1.6;
      (disc.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.15;
    }
  });
  const [x, z] = portal.position;
  const r = portal.radius;
  // Face the gate toward the area origin so it reads from the default camera.
  const yaw = Math.atan2(-x, -z);
  return (
    <group position={[x, PLATFORM_Y, z]}>
      <group rotation={[0, yaw, 0]}>
        <mesh ref={ring} position={[0, r + 0.5, 0]}>
          <torusGeometry args={[r + 0.25, 0.07, 8, 6]} />
          <meshBasicMaterial color={portal.color} toneMapped={false} />
        </mesh>
        <mesh position={[0, r + 0.5, 0]}>
          <circleGeometry args={[r + 0.2, 6]} />
          <meshBasicMaterial color={portal.color} transparent opacity={0.18} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <mesh ref={disc} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.3, r, 6, 1]} />
        <meshBasicMaterial color={portal.color} transparent opacity={0.4} toneMapped={false} depthWrite={false} />
      </mesh>
      <NameTag text={`→ ${portal.label}`} color={portal.color} position={[0, r * 2 + 1.1, 0]} bright />
    </group>
  );
}

/** Generic data-driven set dressing (see AreaDecor). */
function Decor({ item }: { item: AreaDecor }) {
  if (item.kind === "billboard") {
    return <NameTag text={item.text} color={item.color} position={[...item.position]} bright height={item.height} />;
  }
  const [w, h] = item.size;
  const lines = item.lines ?? 0;
  return (
    <group position={[...item.position]} rotation={[0, item.yaw ?? 0, 0]}>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color={item.color} transparent opacity={0.14} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
        <lineBasicMaterial color={item.color} toneMapped={false} />
      </lineSegments>
      {Array.from({ length: lines }, (_, i) => (
        <mesh key={i} position={[-w * 0.08, h * 0.3 - (i * h * 0.6) / Math.max(1, lines - 1), 0.01]}>
          <planeGeometry args={[w * (0.7 - i * 0.12), h * 0.07]} />
          <meshBasicMaterial color={item.color} transparent opacity={0.7} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function HubCore({ color }: { color: string }) {
  const core = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (core.current) core.current.rotation.y += dt * 0.4;
  });
  return (
    <group>
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6, 1.9, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <group ref={core} position={[0, 3.2, 0]}>
        <mesh>
          <octahedronGeometry args={[0.9, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} wireframe toneMapped={false} />
        </mesh>
        <mesh scale={0.55}>
          <icosahedronGeometry args={[0.9, 0]} />
          <meshStandardMaterial color="#e0fbff" emissive={color} emissiveIntensity={0.9} flatShading toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 3.2, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <FloatingPanel key={i} angle={(i / 6) * Math.PI * 2} radius={4.4} y={2.2} color={i % 2 ? "#8B5CF6" : color} />
      ))}
    </group>
  );
}

function FloatingPanel({ angle, radius, y, color }: { angle: number; radius: number; y: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = y + Math.sin(clock.elapsedTime * 1.3 + angle * 3) * 0.18;
  });
  return (
    <group ref={ref} position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius]} rotation={[0, -angle + Math.PI / 2, 0]}>
      <mesh>
        <planeGeometry args={[1.5, 0.9]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(1.5, 0.9)]} />
        <lineBasicMaterial color={color} toneMapped={false} />
      </lineSegments>
      {[0.22, 0.05, -0.12].map((ly, i) => (
        <mesh key={ly} position={[-0.25 + i * 0.08, ly, 0.01]}>
          <planeGeometry args={[0.8 - i * 0.2, 0.05]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Gate + nameplate at the outer edge of a homepage. */
function HomeArch({ zone }: { zone: Zone }) {
  const len = Math.hypot(zone.center[0], zone.center[1]) || 1;
  const out: Vec2 = [zone.center[0] / len, zone.center[1] / len];
  const d = zone.radius * 0.82;
  const yaw = Math.atan2(out[0], out[1]);
  return (
    <group position={[out[0] * d, 0, out[1] * d]} rotation={[0, yaw, 0]}>
      {[-1.2, 1.2].map((px) => (
        <mesh key={px} position={[px, 1.1, 0]}>
          <boxGeometry args={[0.12, 2.2, 0.12]} />
          <meshBasicMaterial color={zone.color} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 2.25, 0]}>
        <boxGeometry args={[2.52, 0.12, 0.12]} />
        <meshBasicMaterial color={zone.color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.1, 0]}>
        <planeGeometry args={[2.3, 2.1]} />
        <meshBasicMaterial color={zone.color} transparent opacity={0.08} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Walkway({ a, b, width, color, onFloorClick }: { a: Vec2; b: Vec2; width: number; color: string; onFloorClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const pulses = useRef<THREE.Group>(null);
  const count = Math.max(2, Math.round(length / 5));
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
      <mesh position={[0, -0.12, 0]} onClick={onFloorClick}>
        <boxGeometry args={[width, 0.2, length]} />
        <meshStandardMaterial color="#04141c" emissive={color} emissiveIntensity={0.08} roughness={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * width) / 2, 0.01, 0]}>
          <boxGeometry args={[0.07, 0.06, length]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
      <group ref={pulses}>
        {Array.from({ length: count }, (_, i) => (
          <mesh key={i} position={[0, 0.03, 0]}>
            <boxGeometry args={[width * 0.5, 0.03, 0.5]} />
            <meshBasicMaterial color={color} transparent opacity={0.75} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Visually start/stop a walkway at the platform rims (collision still uses centre-to-centre). */
function trimToEdges(a: Vec2, b: Vec2, za: Zone | undefined, zb: Zone | undefined): [Vec2, Vec2] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const ra = za ? zoneEdgeDistance(za, ux, uz) - 0.4 : 0;
  const rb = zb ? zoneEdgeDistance(zb, -ux, -uz) - 0.4 : 0;
  return [
    [a[0] + ux * Math.max(0, ra), a[1] + uz * Math.max(0, ra)],
    [b[0] - ux * Math.max(0, rb), b[1] - uz * Math.max(0, rb)],
  ];
}

/**
 * Billboarded nameplate drawn to a CanvasTexture: no DOM overlay roots and no
 * runtime font download (drei Text fetches one), so it works offline too.
 */
function NameTag({ text, color, position, bright, height = 0.42 }: { text: string; color: string; position: [number, number, number]; bright: boolean; height?: number }) {
  const { texture, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    const font = "600 40px ui-monospace, SFMono-Regular, Menlo, monospace";
    const label = text.toUpperCase();
    let w = 320;
    if (g) {
      g.font = font;
      w = Math.ceil(g.measureText(label).width) + 48;
    }
    c.width = w;
    c.height = 64;
    if (g) {
      g.fillStyle = "rgba(4,10,16,0.82)";
      g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = color;
      g.lineWidth = 4;
      g.strokeRect(2, 2, c.width - 4, c.height - 4);
      g.font = font;
      g.fillStyle = color;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, c.width / 2, c.height / 2 + 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { texture: t, aspect: c.width / c.height };
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  const h = height;
  return (
    <sprite position={position} scale={[h * aspect, h, 1]}>
      <spriteMaterial map={texture} transparent opacity={bright ? 1 : 0.8} toneMapped={false} depthWrite={false} />
    </sprite>
  );
}

/* ── Characters ───────────────────────────────────────────────────────── */

function Resident({ zone, anima, near, quality }: { zone: Zone; anima: WorldAnima; near: boolean; quality: ReturnType<typeof useRendererQuality>["quality"] }) {
  const { vessel } = useCharacterVessel(anima.mock ? null : anima.id);
  const model = useMemo(() => {
    const m = vesselToBattleModel(vessel?.config, anima.name);
    return vessel ? m : { ...m, color: zone.color };
  }, [vessel, anima.name, zone.color]);
  const [sx, sz] = animaStandPoint(zone);
  // Face the hub.
  const yaw = Math.atan2(-sx, -sz);
  return (
    <group position={[sx, PLATFORM_Y, sz]}>
      <group rotation={[0, yaw, 0]} scale={1.25}>
        {/* Own boundary so a resident's GLTF/face texture loading never re-suspends the world. */}
        <Suspense fallback={null}>
          <SerenityFigure model={model} anchored quality={quality} expression={near ? 0.6 : 0.15} />
        </Suspense>
      </group>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 0.85, 32]} />
        <meshBasicMaterial color={zone.color} transparent opacity={near ? 1 : 0.45} toneMapped={false} />
      </mesh>
      <NameTag text={zone.label} color={zone.color} position={[0, 2.55, 0]} bright={near} />
    </group>
  );
}

/** The player's own navi: low-poly, protocol cyan, faces its walk direction. */
function PlayerNavi({ group }: { group: RefObject<THREE.Group | null> }) {
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (body.current) body.current.position.y = Math.sin(clock.elapsedTime * 3) * 0.05;
  });
  return (
    <group ref={group}>
      <group ref={body}>
        <mesh position={[0, 0.75, 0]}>
          <capsuleGeometry args={[0.28, 0.6, 4, 8]} />
          <meshStandardMaterial color="#0b3a78" emissive="#1d4ed8" emissiveIntensity={0.5} flatShading />
        </mesh>
        <mesh position={[0, 1.5, 0]}>
          <icosahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial color="#1e40af" emissive="#2563eb" emissiveIntensity={0.5} flatShading />
        </mesh>
        <mesh position={[0, 1.52, 0.22]}>
          <boxGeometry args={[0.34, 0.09, 0.1]} />
          <meshBasicMaterial color={CYAN} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.85, 0.27]}>
          <octahedronGeometry args={[0.1, 0]} />
          <meshBasicMaterial color="#FACC15" toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.45, 24]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.35} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ── Exploration ──────────────────────────────────────────────────────── */

function DataNodeMesh({ node }: { node: SceneNode }) {
  const g = useRef<THREE.Group>(null);
  const appear = useRef(0);
  useFrame(({ clock }, dt) => {
    const el = g.current;
    if (!el) return;
    appear.current = Math.min(1, appear.current + dt * 2.5);
    const t = clock.elapsedTime + node.position[0];
    el.rotation.y += dt * 1.4;
    el.position.y = 0.9 + Math.sin(t * 2) * 0.12;
    el.scale.setScalar(appear.current * (node.big ? 1.35 : 1));
  });
  return (
    <group position={[node.position[0], 0, node.position[1]]}>
      <group ref={g} scale={0}>
        <mesh>
          <octahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial color={node.color} emissive={node.color} emissiveIntensity={1.3} flatShading toneMapped={false} />
        </mesh>
        <mesh scale={1.6}>
          <octahedronGeometry args={[0.28, 0]} />
          <meshBasicMaterial color={node.color} wireframe transparent opacity={0.5} toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 3.2, 4, 1, true]} />
        <meshBasicMaterial color={node.color} transparent opacity={0.35} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.45, 6]} />
        <meshBasicMaterial color={node.color} transparent opacity={0.8} toneMapped={false} />
      </mesh>
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
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.92, 1, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/** Accompanying Anima: trails behind the player's shoulder. */
function Follower({ anima, telemetry, quality }: { anima: WorldAnima; telemetry: MutableRefObject<PlayerTelemetry>; quality: ReturnType<typeof useRendererQuality>["quality"] }) {
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
          <SerenityFigure model={model} anchored quality={quality} expression={0.4} />
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

const CAMERA_OFFSET: readonly [number, number, number] = [0, 10, 14];

function World({ area, spawn, animas, touchMove, telemetry, commands, onPortal, onStep, nearAnimaId, onNearChange, quality, tint, nodes, scanPulseAt = 0, companion }: SceneProps & { quality: ReturnType<typeof useRendererQuality>["quality"] }) {
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

    const near = nearestAnima(area, animas, next);
    const id = near ? near.anima.id : null;
    if (id !== nearId.current) {
      nearId.current = id;
      onNearChange(id);
    }
  });

  return (
    <>
      <color attach="background" args={[tint?.fog ?? BG]} />
      <fog attach="fog" args={[tint?.fog ?? BG, 30, 70]} />
      <ambientLight intensity={0.35 * (tint?.light ?? 1)} />
      <directionalLight position={[8, 14, 6]} intensity={0.6 * (tint?.light ?? 1)} color="#bfe9ff" />
      <pointLight position={[0, 6, 0]} intensity={30} distance={30} color={tint?.accent ?? area.theme.accent} />
      <Stars radius={80} depth={30} count={quality.stars} factor={3} fade speed={0.4} />
      <Grid
        position={[0, -3, 0]}
        args={[200, 200]}
        cellSize={1}
        cellThickness={0.5}
        cellColor={area.kind === "hub" && tint ? tint.gridCell : area.theme.gridCell}
        sectionSize={6}
        sectionThickness={1}
        sectionColor={area.kind === "hub" && tint ? tint.gridSection : area.theme.gridSection}
        fadeDistance={70}
        fadeStrength={1.5}
        infiniteGrid
      />

      {area.paths.map((path) => {
        const ends = pathEndpoints(area, path);
        if (!ends) return null;
        const from = zonesById.get(path.from);
        const to = zonesById.get(path.to);
        const [a, b] = trimToEdges(ends[0], ends[1], from, to);
        return <Walkway key={path.id} a={a} b={b} width={path.width} color={path.color || to?.color || CYAN} onFloorClick={onFloorClick} />;
      })}
      {area.zones.map((zone) => (
        // The hub plaza takes on the real-world biome tint; homes keep their Anima colours.
        <Platform key={zone.id} zone={zone.kind === "hub" && tint ? { ...zone, color: tint.accent } : zone} onFloorClick={onFloorClick} />
      ))}
      {area.zones.map((zone) => {
        const anima = zone.animaId ? animas.find((a) => a.id === zone.animaId) : null;
        return anima && anima.id !== companion?.id ? <Resident key={zone.id} zone={zone} anima={anima} near={anima.id === nearAnimaId} quality={quality} /> : null;
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

      <PlayerNavi group={player} />
      <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.25, 0.38, 24]} />
        <meshBasicMaterial color="#FACC15" toneMapped={false} />
      </mesh>

      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        minDistance={5}
        maxDistance={26}
        minPolarAngle={0.35}
        maxPolarAngle={1.25}
        enableDamping
        dampingFactor={0.12}
      />

      {quality.postprocessing && (
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.3} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

export default function CyberworldScene(props: SceneProps) {
  const { quality, handleDecline, handleIncline } = useRendererQuality();
  const [sx, sz] = props.spawn;
  return (
    <Canvas
      camera={{ position: [sx + CAMERA_OFFSET[0], CAMERA_OFFSET[1], sz + CAMERA_OFFSET[2]], fov: 45, near: 0.1, far: 200 }}
      gl={{ alpha: false, antialias: quality.antialias, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      dpr={quality.dpr as [number, number]}
      style={{ width: "100%", height: "100%", display: "block", background: BG, touchAction: "none" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
      }}
    >
      <PerformanceMonitor flipflops={3} onDecline={handleDecline} onIncline={handleIncline}>
        {/* Keyed per visit so arriving through a portal is a clean respawn. */}
        <World key={`${props.area.id}:${props.spawn[0]},${props.spawn[1]}`} {...props} quality={quality} />
      </PerformanceMonitor>
    </Canvas>
  );
}
