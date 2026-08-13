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
  }),
});

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

  let webgl2 = true;
  try {
    const canvas = source?.document?.createElement?.("canvas");
    if (canvas) webgl2 = Boolean(canvas.getContext("webgl2"));
  } catch {
    webgl2 = false;
  }

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
