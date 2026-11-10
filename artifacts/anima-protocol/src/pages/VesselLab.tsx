/**
 * /vessel/lab (dev only: `vite dev` or VITE_VESSEL_LAB=1) — photo-to-vessel experiment.
 *  1. Pick one frontal photo (stays in this tab; nothing is uploaded).
 *  2. MediaPipe Face (478 pts + 52 blendshapes) and Pose Landmarker run on-device,
 *     points are overlaid for a quality check.
 *  3. "Build head" fits the head blockout (lib/vessel/photoFit), exports a GLB and
 *     loads it into the Vessel Studio canvas through config.model.kind = "gltf".
 * Fictional / consenting likenesses only.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultVesselFor, type VesselConfig } from "@/lib/vessel/vesselConfig";
import { expressionFor } from "@/lib/vessel/emotion";
import type { ArkitFaceWeights } from "@/lib/vessel/arkitFace";
import { FACE_TRIANGLES } from "@/lib/vessel/photoFit/faceTopology.data";
import { fitPhotoHead, type PhotoHead } from "@/lib/vessel/photoFit/headFit";
import { detectPhotoLandmarks, topBlendshapes, type PhotoLandmarks } from "@/lib/vessel/photoFit/landmarker";

const VesselCanvas = lazy(() => import("@/components/vessel/VesselCanvas"));

const POSE_EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
];

type Pose = "idle" | "talk" | "smile" | "blink" | "jaw";
const POSES: Record<Pose, { override: ArkitFaceWeights | null; speaking: boolean; mood: string }> = {
  idle: { override: null, speaking: false, mood: "neutral" },
  talk: { override: null, speaking: true, mood: "neutral" },
  smile: { override: { mouthSmileLeft: 1, mouthSmileRight: 1, eyeBlinkLeft: 0, eyeBlinkRight: 0, jawOpen: 0 }, speaking: false, mood: "happy" },
  blink: { override: { eyeBlinkLeft: 1, eyeBlinkRight: 1, jawOpen: 0, mouthSmileLeft: 0, mouthSmileRight: 0 }, speaking: false, mood: "neutral" },
  jaw: { override: { jawOpen: 1, eyeBlinkLeft: 0, eyeBlinkRight: 0, mouthSmileLeft: 0, mouthSmileRight: 0 }, speaking: false, mood: "neutral" },
};

declare global {
  interface Window {
    __vesselLab?: Record<string, unknown>;
  }
}

function drawOverlay(canvas: HTMLCanvasElement, img: HTMLImageElement, lm: PhotoLandmarks, zoom: HTMLCanvasElement | null) {
  const W = img.naturalWidth, H = img.naturalHeight;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const r = Math.max(1, Math.round(Math.max(W, H) / 700));
  const face = lm.face.faceLandmarks[0];
  const pose = lm.pose.landmarks[0];
  const paint = (c: CanvasRenderingContext2D, sx: number, sy: number, ox: number, oy: number, dot: number) => {
    if (pose) {
      c.strokeStyle = "rgba(255,200,0,0.9)";
      c.lineWidth = dot * 1.5;
      for (const [a, b] of POSE_EDGES) {
        if ((pose[a].visibility ?? 1) < 0.3 || (pose[b].visibility ?? 1) < 0.3) continue;
        c.beginPath();
        c.moveTo(pose[a].x * sx - ox, pose[a].y * sy - oy);
        c.lineTo(pose[b].x * sx - ox, pose[b].y * sy - oy);
        c.stroke();
      }
      c.fillStyle = "#ffcc00";
      for (const p of pose) if ((p.visibility ?? 1) >= 0.3) c.fillRect(p.x * sx - ox - dot * 1.5, p.y * sy - oy - dot * 1.5, dot * 3, dot * 3);
    }
    if (face) {
      c.strokeStyle = "rgba(0,255,200,0.35)";
      c.lineWidth = Math.max(0.5, dot * 0.4);
      c.beginPath();
      for (let t = 0; t < FACE_TRIANGLES.length; t += 3) {
        const a = face[FACE_TRIANGLES[t]], b = face[FACE_TRIANGLES[t + 1]], d = face[FACE_TRIANGLES[t + 2]];
        c.moveTo(a.x * sx - ox, a.y * sy - oy);
        c.lineTo(b.x * sx - ox, b.y * sy - oy);
        c.lineTo(d.x * sx - ox, d.y * sy - oy);
        c.closePath();
      }
      c.stroke();
      face.forEach((p, i) => {
        c.fillStyle = i >= 468 ? "#ff3b8d" : "#00ffd0";
        c.beginPath();
        c.arc(p.x * sx - ox, p.y * sy - oy, i >= 468 ? dot * 1.4 : dot * 0.8, 0, Math.PI * 2);
        c.fill();
      });
    }
  };
  paint(ctx, W, H, 0, 0, r);
  if (zoom && face) {
    const xs = face.map((p) => p.x * W), ys = face.map((p) => p.y * H);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const m = 0.15 * Math.max(x1 - x0, y1 - y0);
    const bx = Math.max(0, x0 - m), by = Math.max(0, y0 - m), bw = Math.min(W, x1 + m) - bx, bh = Math.min(H, y1 + m) - by;
    const k = 768 / Math.max(bw, bh);
    zoom.width = Math.round(bw * k);
    zoom.height = Math.round(bh * k);
    const z = zoom.getContext("2d")!;
    z.imageSmoothingQuality = "high";
    z.drawImage(img, bx, by, bw, bh, 0, 0, zoom.width, zoom.height);
    paint(z, W * k, H * k, bx * k, by * k, 1.6);
  }
}

function hexDist(a: string, b: string) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Skin from the cheek; hair from patches above / beside the face, picking the one least like skin. */
function headColors(lm: PhotoLandmarks, sample: (rect: { x: number; y: number; w: number; h: number }, percentile?: number) => string) {
  const f = lm.face.faceLandmarks[0];
  const top = f[10], chin = f[152], l = f[234], r = f[454];
  const fh = chin.y - top.y, fw = r.x - l.x;
  const skin = sample({ x: f[50].x - fw * 0.04, y: f[50].y - fh * 0.03, w: fw * 0.08, h: fh * 0.06 });
  const patches = [
    { x: top.x - fw * 0.1, y: top.y - fh * 0.3, w: fw * 0.2, h: fh * 0.08 },
    { x: l.x - fw * 0.1, y: top.y + fh * 0.02, w: fw * 0.1, h: fh * 0.1 },
    { x: r.x, y: top.y + fh * 0.02, w: fw * 0.1, h: fh * 0.1 },
  ].map((rect) => sample(rect, 0.85));
  const hair = patches.reduce((best, c) => (hexDist(c, skin) > hexDist(best, skin) ? c : best), patches[0]);
  return { hair, skin };
}

export default function VesselLab() {
  const [character, setCharacter] = useState("serenity");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [lm, setLm] = useState<PhotoLandmarks | null>(null);
  const [head, setHead] = useState<PhotoHead | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [glbBytes, setGlbBytes] = useState(0);
  const [headColorsUsed, setHeadColorsUsed] = useState<{ hair: string; skin: string } | null>(null);
  const [pose, setPose] = useState<Pose>("idle");
  const [status, setStatus] = useState("Pick a frontal photo of a fictional or consenting character.");
  const overlay = useRef<HTMLCanvasElement>(null);
  const zoom = useRef<HTMLCanvasElement>(null);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setLm(null);
    setHead(null);
    setGlbUrl((u) => (u && URL.revokeObjectURL(u), null));
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.src = url;
    await im.decode();
    setPhotoName(file.name);
    setImg(im);
    setStatus("Running Face + Pose Landmarker on-device…");
    try {
      const res = await detectPhotoLandmarks(im);
      setLm(res);
      setStatus(res.face.faceLandmarks.length ? "Landmarks ready. Build the head when the overlay looks right." : "No face detected.");
    } catch (e) {
      setStatus(`Landmarker failed: ${String((e as Error)?.message || e)}`);
    }
  }, []);

  useEffect(() => {
    if (img && lm && overlay.current) drawOverlay(overlay.current, img, lm, zoom.current);
  }, [img, lm]);

  const build = useCallback(async () => {
    if (!img || !lm?.face.faceLandmarks[0]) return;
    setStatus("Fitting head…");
    const [{ buildPhotoHeadScene, exportGlb, sampleRegionColor }] = await Promise.all([import("@/lib/vessel/photoFit/headMesh")]);
    const fitted = fitPhotoHead(lm.face.faceLandmarks[0], img.naturalWidth, img.naturalHeight);
    const colors = headColors(lm, (rect, pct) => sampleRegionColor(img, rect, pct));
    setHeadColorsUsed(colors);
    const scene = buildPhotoHeadScene(fitted, img, colors, { name: `${character}-head` });
    const bytes = await exportGlb(scene);
    const url = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
    setHead(fitted);
    setGlbBytes(bytes.byteLength);
    setGlbUrl((old) => (old && URL.revokeObjectURL(old), url));
    setStatus(`Head built: ${fitted.metrics.vertexCount} verts, ${fitted.metrics.triangleCount} tris, ${(bytes.byteLength / 1024).toFixed(0)} KB GLB.`);
  }, [img, lm, character]);

  const config: VesselConfig | null = useMemo(() => {
    if (!glbUrl) return null;
    const base = defaultVesselFor({ name: character });
    // Local dev only: a blob: URL is deliberately outside the saved-config schema, so this never persists.
    return { ...base, model: { kind: "gltf", url: glbUrl, format: "glb" } };
  }, [glbUrl, character]);
  const p = POSES[pose];
  const expression = useMemo(() => expressionFor(p.mood, 80), [p.mood]);

  const summary = useMemo(() => {
    if (!lm) return null;
    return {
      photo: photoName,
      size: img ? [img.naturalWidth, img.naturalHeight] : null,
      delegate: lm.delegate,
      ms: lm.ms,
      faces: lm.face.faceLandmarks.length,
      faceLandmarks: lm.face.faceLandmarks[0]?.length ?? 0,
      blendshapes: lm.face.faceBlendshapes?.[0]?.categories.length ?? 0,
      topBlendshapes: topBlendshapes(lm.face, 6),
      poses: lm.pose.landmarks.length,
      poseVisible: lm.pose.landmarks[0]?.filter((q) => (q.visibility ?? 0) >= 0.5).length ?? 0,
      head: head?.metrics ?? null,
      colors: headColorsUsed,
      glbBytes,
    };
  }, [lm, img, photoName, head, glbBytes, headColorsUsed]);

  useEffect(() => {
    window.__vesselLab = {
      status,
      summary,
      glbUrl,
      setPose,
      ready: Boolean(glbUrl),
      landmarks: lm?.face.faceLandmarks[0] ?? null,
      imageSize: img ? [img.naturalWidth, img.naturalHeight] : null,
    };
  }, [status, summary, glbUrl, lm, img]);

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <h1 className="text-xl font-semibold">Vessel lab: photo → head (dev)</h1>
      <p className="mt-1 text-sm text-slate-400">On-device only. Photos never leave this tab. Use fictional or consenting likenesses.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <select data-testid="lab-character" value={character} onChange={(e) => setCharacter(e.target.value)} className="rounded bg-slate-800 px-2 py-1">
          {["serenity", "scarlet", "aeland", "linda", "custom"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input data-testid="lab-photo" type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
        <button data-testid="lab-build" disabled={!lm?.face.faceLandmarks.length} onClick={build} className="rounded bg-violet-600 px-3 py-1 disabled:opacity-40">
          Build head
        </button>
        {glbUrl && (
          <a href={glbUrl} download={`${character}-head.glb`} className="underline">
            Download GLB
          </a>
        )}
        <span data-testid="lab-status" className="text-slate-300">{status}</span>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <canvas data-testid="lab-overlay" ref={overlay} className="w-full rounded border border-slate-800" />
        <canvas data-testid="lab-zoom" ref={zoom} className="w-full rounded border border-slate-800" />
        <div className="flex flex-col gap-2">
          {config && (
            <>
              <div className="flex gap-2 text-xs">
                {(Object.keys(POSES) as Pose[]).map((k) => (
                  <button key={k} data-testid={`lab-pose-${k}`} onClick={() => setPose(k)} className={`rounded px-2 py-1 ${pose === k ? "bg-violet-600" : "bg-slate-800"}`}>
                    {k}
                  </button>
                ))}
              </div>
              <div data-testid="lab-studio">
              <Suspense fallback={<div className="h-[480px]" />}>
                <VesselCanvas
                  config={config}
                  expression={expression}
                  speaking={p.speaking}
                  faceOverride={p.override}
                  focus="head"
                  hd
                  className="h-[480px] w-full rounded border border-slate-800"
                />
              </Suspense>
              </div>
            </>
          )}
          {summary && <pre data-testid="lab-summary" className="max-h-80 overflow-auto rounded bg-slate-900 p-2 text-xs">{JSON.stringify(summary, null, 2)}</pre>}
        </div>
      </div>
    </div>
  );
}
