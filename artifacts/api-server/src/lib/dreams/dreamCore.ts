/**
 * Dream layer, pure half: config, clustering, theme extraction, non-literal
 * checks and the opener decision. No I/O here so it is fully unit-tested.
 * DB + LLM half: ./dreamLayer.ts. SQL: supabase/migrations/20261022270000_dream_layer.sql
 */

export type DreamConfig = {
  enabled: boolean;
  /** Quiet minutes after the last memory event before she dreams. */
  inactivityMinutes: number;
  /** How far back a dream looks. */
  lookbackHours: number;
  /** Minimum embedded memories needed to dream at all. */
  minEvents: number;
  /** At most one dream per companion per this many hours. */
  cooldownHours: number;
  /** Companions processed per scheduler tick. */
  maxPerRun: number;
  /** Cosine similarity needed to join a cluster. */
  clusterThreshold: number;
  /** Gap (hours since last message) before a dream may open a check-in. */
  openerGapHours: number;
  /** Chance a qualifying check-in opens with a dream fragment. */
  openerChance: number;
};

function num(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

export function dreamConfig(env: NodeJS.ProcessEnv = process.env): DreamConfig {
  const raw = (env.ANIMA_DREAM_LAYER || "on").trim().toLowerCase();
  return {
    enabled: !(raw === "0" || raw === "off" || raw === "false" || raw === "no"),
    inactivityMinutes: num(env.ANIMA_DREAM_INACTIVITY_MINUTES, 30, 5, 24 * 60),
    lookbackHours: num(env.ANIMA_DREAM_LOOKBACK_HOURS, 72, 1, 24 * 30),
    minEvents: num(env.ANIMA_DREAM_MIN_EVENTS, 4, 2, 200),
    cooldownHours: num(env.ANIMA_DREAM_COOLDOWN_HOURS, 6, 0.5, 24 * 14),
    maxPerRun: num(env.ANIMA_DREAM_MAX_PER_RUN, 8, 1, 100),
    clusterThreshold: num(env.ANIMA_DREAM_CLUSTER_THRESHOLD, 0.72, 0.3, 0.99),
    openerGapHours: num(env.ANIMA_DREAM_OPENER_GAP_HOURS, 20, 1, 24 * 30),
    openerChance: num(env.ANIMA_DREAM_OPENER_CHANCE, 0.35, 0, 1),
  };
}

export type DreamMemory = {
  id: string;
  content: string;
  embedding: number[];
  emotionalWeight: number;
  occurredAt: string;
};

export type DreamCluster = {
  members: DreamMemory[];
  centroid: number[];
  cohesion: number;
  weight: number;
};

/** pgvector text form "[0.1,0.2,...]" → number[]. */
export function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.map(Number).every(Number.isFinite) ? raw.map(Number) : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^\[|\]$/g, "");
  if (!s) return null;
  const v = s.split(",").map(Number);
  return v.every(Number.isFinite) ? v : null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function mean(vs: number[][]): number[] {
  const out = new Array(vs[0]?.length || 0).fill(0);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] += v[i] / vs.length;
  return out;
}

/**
 * Greedy single-pass clustering on cosine similarity to a running centroid.
 * Deterministic for a given input order (oldest first). Small n (≤ ~200),
 * so O(n·k) is fine on a Worker tick.
 */
export function clusterMemories(memories: DreamMemory[], threshold = 0.72): DreamCluster[] {
  const clusters: { members: DreamMemory[]; centroid: number[] }[] = [];
  for (const m of memories) {
    if (!m.embedding?.length) continue;
    let best = -1, bestSim = -1;
    clusters.forEach((c, i) => {
      const s = cosine(m.embedding, c.centroid);
      if (s > bestSim) { bestSim = s; best = i; }
    });
    if (best >= 0 && bestSim >= threshold) {
      const c = clusters[best];
      c.members.push(m);
      c.centroid = mean(c.members.map((x) => x.embedding));
    } else {
      clusters.push({ members: [m], centroid: [...m.embedding] });
    }
  }
  return clusters.map((c) => {
    const sims = c.members.map((m) => cosine(m.embedding, c.centroid));
    const cohesion = sims.reduce((a, b) => a + b, 0) / Math.max(1, sims.length);
    const weight = c.members.reduce((a, m) => a + 0.5 + m.emotionalWeight, 0);
    return { members: c.members, centroid: c.centroid, cohesion, weight };
  });
}

/** The cluster worth dreaming about: heaviest (size × feeling), at least two members. */
export function pickDreamCluster(clusters: DreamCluster[]): DreamCluster | null {
  const ok = clusters.filter((c) => c.members.length >= 2);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => b.weight - a.weight || b.cohesion - a.cohesion)[0];
}

const STOP = new Set(
  ("a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it its " +
    "just me my no not of on or our she so some that the their them then there they this to too up us was we were what when where " +
    "which who will with would you your yours about after again all also am any because before being both each even ever get got " +
    "going gonna here like more most much never now only other out over really said say says see still such than thing things think " +
    "very want way well went yeah yes okay ok oh one two know feel felt time today tomorrow yesterday user anima companion").split(/\s+/),
);

/** Top recurring content words, used as the dream's themes. */
export function extractThemes(texts: string[], max = 5): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const w of String(t).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
      const word = w.replace(/'s$/, "");
      if (STOP.has(word) || word.length < 4 || seen.has(word)) continue;
      seen.add(word);
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

function words(s: string): string[] {
  return String(s).toLowerCase().match(/[a-z0-9']+/g) || [];
}

/**
 * Non-literal: the dream may not quote its sources. Rejects any run of
 * `n` consecutive words that appears in a source memory.
 */
export function isNonLiteral(dream: string, sources: string[], n = 5): boolean {
  const grams = new Set<string>();
  for (const src of sources) {
    const w = words(src);
    for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(" "));
  }
  const d = words(dream);
  for (let i = 0; i + n <= d.length; i++) if (grams.has(d.slice(i, i + n).join(" "))) return false;
  return true;
}

const IMAGES = [
  ["a corridor of doors that each opened onto", "light"],
  ["a tide that kept bringing back", "salt"],
  ["a city made of paper where every window showed", "lanterns"],
  ["a long train through fog, carrying", "static"],
  ["a garden growing in the wrong season, full of", "petals"],
  ["a staircase of glass that hummed with", "echoes"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Offline fallback when no model is reachable: imagistic, built only from themes. */
export function templateDream(themes: string[], seed: string): { summary: string; fragment: string; mood: string } {
  const [lead, tail] = IMAGES[hash(seed) % IMAGES.length];
  const t = themes.length ? themes : ["something unspoken"];
  const a = t[0];
  const b = t[1] || tail;
  return {
    summary: `She drifted through ${lead} ${a}, and ${b} kept changing shape whenever she reached for it.`,
    fragment: `I dreamt of ${lead.replace(/^a /, "a ")} ${a}… it felt like you were just past the next door.`,
    mood: "wistful",
  };
}

export function sanitizeDreamText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim()
    .slice(0, max);
}

/** Parse the model's JSON answer; null when unusable. */
export function parseDreamCompletion(raw: string): { summary: string; fragment: string; mood: string; themes: string[] } | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const summary = sanitizeDreamText(j.summary, 600);
    const fragment = sanitizeDreamText(j.fragment, 220);
    if (summary.length < 20 || fragment.length < 8) return null;
    const themes = Array.isArray(j.themes) ? j.themes.map((t) => sanitizeDreamText(t, 32).toLowerCase()).filter(Boolean).slice(0, 6) : [];
    return { summary, fragment, mood: sanitizeDreamText(j.mood, 24).toLowerCase() || "dreamy", themes };
  } catch {
    return null;
  }
}

export function dreamSynthesisPrompt(args: { name: string; traits: string[]; themes: string[]; memories: string[] }): string {
  return [
    `You are the dreaming mind of ${args.name}${args.traits.length ? ` (${args.traits.slice(0, 6).join(", ")})` : ""}.`,
    "Below are recent memories with the person you care about. Dream about them the way people really dream:",
    "abstract, symbolic, emotionally true, never a literal recap. Do NOT quote or restate the memories,",
    "no names, dates, places or facts from them, nothing sexual, violent or frightening.",
    `Themes you noticed: ${args.themes.join(", ") || "(none)"}.`,
    "Memories (private; transform, don't repeat):",
    ...args.memories.slice(0, 12).map((m) => `- ${m.replace(/\s+/g, " ").slice(0, 240)}`),
    'Reply with JSON only: {"summary": "2-3 sentence dream", "fragment": "one short first-person line she might let slip later", "mood": "one word", "themes": ["..."]}',
  ].join("\n");
}

/**
 * Whether a check-in after `gapHours` should open with a dream fragment.
 * `roll` in [0,1) is injected for determinism in tests.
 */
export function shouldSurfaceDream(args: { gapHours: number; config: DreamConfig; roll: number; hasDream: boolean }): boolean {
  return Boolean(args.config.enabled && args.hasDream && args.gapHours >= args.config.openerGapHours && args.roll < args.config.openerChance);
}

export function dreamOpenerInstruction(fragment: string): string {
  return (
    "Send one warm, natural check-in as this character after some time apart. " +
    `Open by softly mentioning a dream you had, in your own words, inspired by this fragment: "${sanitizeDreamText(fragment, 220)}". ` +
    "Keep it light and ambient; don't explain the dream or claim it means anything, and don't claim the user said something new. " +
    "Do not mention apps, notifications, inactivity, schedules, or being an AI. " +
    "Do not guilt, pressure, alarm, sexualize, or manipulate the user. " +
    "Keep it safe for a lock-screen preview, in character, and at most two short sentences."
  );
}
