export const RENDERER_QUALITY = Object.freeze({
  low: Object.freeze({
    name: "low",
    dpr: [1, 1],
    transmission: 0,
    postprocessing: false,
    stars: 320,
    sparkles: 0,
    tesseracts: 0,
    antialias: false,
    animateCamera: false,
    vesselHd: false,
    vesselFacets: 2,
    vesselHair: 8,
    vesselBreath: true,
  }),
  medium: Object.freeze({
    name: "medium",
    dpr: [1, 1.5],
    transmission: 0.12,
    postprocessing: true,
    stars: 800,
    sparkles: 34,
    tesseracts: 1,
    antialias: true,
    animateCamera: true,
    vesselHd: true,
    vesselFacets: 4,
    vesselHair: 12,
    vesselBreath: true,
  }),
  high: Object.freeze({
    name: "high",
    dpr: [1, 2],
    transmission: 0.35,
    postprocessing: true,
    stars: 1400,
    sparkles: 84,
    tesseracts: 2,
    antialias: true,
    animateCamera: true,
    vesselHd: true,
    vesselFacets: 6,
    vesselHair: 18,
    vesselBreath: true,
  }),
});

const webgl2Probes = new WeakMap();

/**
 * WebGL2 support, probed once per window. The probe context is released right
 * away: every quality hook used to leave a live WebGL2 context behind (two per
 * mount under StrictMode), counting against iOS Safari's small context budget.
 */
function probeWebgl2(source) {
  const key = source && typeof source === "object" ? source : null;
  if (key && webgl2Probes.has(key)) return webgl2Probes.get(key);
  let webgl2 = true;
  try {
    const canvas = source?.document?.createElement?.("canvas");
    if (canvas) {
      const gl = canvas.getContext("webgl2");
      webgl2 = Boolean(gl);
      gl?.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    }
  } catch {
    webgl2 = false;
  }
  if (key) webgl2Probes.set(key, webgl2);
  return webgl2;
}

export function detectRendererCapabilities(source = globalThis) {
  const navigatorValue = source?.navigator || {};
  let reducedMotion = false;
  try {
    reducedMotion = Boolean(
      source?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    );
  } catch {
    reducedMotion = false;
  }

  const webgl2 = probeWebgl2(source);

  return {
    deviceMemory: Number(navigatorValue.deviceMemory) || null,
    hardwareConcurrency: Number(navigatorValue.hardwareConcurrency) || null,
    pixelRatio: Number(source?.devicePixelRatio) || 1,
    reducedMotion,
    webgl2,
  };
}

export function selectRendererQuality(capabilities = {}) {
  const memory = Number(capabilities.deviceMemory) || null;
  const cores = Number(capabilities.hardwareConcurrency) || null;
  const pixelRatio = Number(capabilities.pixelRatio) || 1;

  if (
    capabilities.reducedMotion ||
    capabilities.webgl2 === false ||
    (memory != null && memory <= 2) ||
    (cores != null && cores <= 2)
  ) {
    return RENDERER_QUALITY.low;
  }
  if (
    memory != null &&
    memory >= 8 &&
    cores != null &&
    cores >= 8 &&
    pixelRatio <= 2.5
  ) {
    return RENDERER_QUALITY.high;
  }
  return RENDERER_QUALITY.medium;
}

export function lowerRendererQuality(current) {
  if (current?.name === "high") return RENDERER_QUALITY.medium;
  return RENDERER_QUALITY.low;
}

export function raiseRendererQuality(current, ceiling) {
  if (ceiling?.name === "low") return RENDERER_QUALITY.low;
  if (current?.name === "low") return RENDERER_QUALITY.medium;
  if (ceiling?.name === "high") return RENDERER_QUALITY.high;
  return RENDERER_QUALITY.medium;
}
