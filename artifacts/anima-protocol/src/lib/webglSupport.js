/**
 * WebGL detection that doesn't cost a live context.
 *
 * Probes WebGL2 then WebGL1 with default attributes (never
 * failIfMajorPerformanceCaveat) and releases each probe context immediately
 * via WEBGL_lose_context. Unreleased probe contexts count against Safari's
 * small live-context budget until GC, which can starve the real renderer.
 */

function releaseContext(ctx) {
  try {
    ctx?.getExtension?.("WEBGL_lose_context")?.loseContext();
  } catch {
    /* ignore */
  }
}

/** @returns {{ webgl2: boolean, webgl1: boolean, error: string | null }} */
export function probeWebGL(createCanvas = () => (typeof document === "undefined" ? null : document.createElement("canvas"))) {
  const out = { webgl2: false, webgl1: false, error: null };
  const attempts = [
    ["webgl2", ["webgl2"]],
    ["webgl1", ["webgl", "experimental-webgl"]],
  ];
  for (const [key, types] of attempts) {
    for (const type of types) {
      try {
        const canvas = createCanvas();
        const ctx = canvas?.getContext?.(type);
        if (ctx) {
          out[key] = true;
          releaseContext(ctx);
          break;
        }
      } catch (e) {
        out.error = e instanceof Error ? e.message : String(e);
      }
    }
    if (out.webgl2) break;
  }
  return out;
}

let cached = null;
/** Cached once per page load so remounts don't re-probe. */
export function webglProbe() {
  if (!cached) cached = probeWebGL();
  return cached;
}

/** True unless both WebGL2 and WebGL1 genuinely fail. */
export function hasWebGL() {
  if (typeof document === "undefined") return false;
  const p = webglProbe();
  return p.webgl2 || p.webgl1;
}

/** Test hook. */
export function resetWebGLProbe() {
  cached = null;
}
