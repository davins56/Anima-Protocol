/**
 * Optional post-generation anatomy check: a vision model counts the main
 * character's arms / wings / heads / … in the finished image, and a photo
 * that grew extra limbs is re-rendered with a new seed (bounded retries).
 *
 * Opt-in (ANIMA_PHOTO_ANATOMY_CHECK=on). Checks arms on character photos
 * and any other atypical parts, using the Worker's
 * existing Workers AI binding: no binding means the check is skipped, never
 * routed to another cloud service. A failed or timed-out check passes the
 * image through. A confirmed mismatch can be withheld by the caller.
 */
import type { WorkersAiBinding } from "../aiBinding";
import { extractWorkersAiText } from "../workersAi";
import { anatomySummary, atypicalParts, HUMAN_DEFAULTS, type AnatomyPart, type AnatomySpec } from "./anatomy";
import { firstJsonObject } from "./intent";

type Env = Record<string, string | undefined>;

export const DEFAULT_ANATOMY_CHECK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

export type AnatomyCheckConfig = {
  enabled: boolean;
  model: string;
  /** Extra renders after the first, 0–2. */
  maxRetries: number;
  timeoutMs: number;
};

function on(v: string | undefined): boolean {
  return /^(1|true|on|yes)$/i.test(String(v ?? "").trim());
}

function int(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number(String(v ?? "").trim());
  if (!String(v ?? "").trim() || !Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function anatomyCheckConfig(env: Env = process.env): AnatomyCheckConfig {
  const raw = String(env.ANIMA_PHOTO_ANATOMY_CHECK_MODEL ?? "").trim();
  return {
    enabled: on(env.ANIMA_PHOTO_ANATOMY_CHECK),
    // Workers AI models only: this check must never reach a different provider.
    model: /^@(cf|hf)\//.test(raw) ? raw : DEFAULT_ANATOMY_CHECK_MODEL,
    maxRetries: int(env.ANIMA_PHOTO_ANATOMY_RETRIES, 1, 0, 2),
    timeoutMs: int(env.ANIMA_PHOTO_ANATOMY_CHECK_TIMEOUT_MS, 8_000, 1_000, 30_000),
  };
}

export type AnatomyVerdict =
  | { status: "pass"; observed: Partial<Record<AnatomyPart, number>> }
  | { status: "mismatch"; observed: Partial<Record<AnatomyPart, number>>; mismatches: AnatomyPart[]; score: number }
  | { status: "skipped"; reason: "off" | "not_needed" | "no_binding" | "too_large" | "error" | "unreadable" };

export type AnatomyVerifier = (image: { bytes: Uint8Array; contentType: string }) => Promise<AnatomyVerdict>;

const MAX_CHECK_BYTES = 4 * 1024 * 1024;

export function anatomyCheckMessages(name: string, spec: AnatomySpec, parts: AnatomyPart[], dataUrl: string) {
  const who = String(name || "the main character").slice(0, 60);
  const keys = parts.map((p) => `"${p}": number|null`).join(", ");
  return [
    {
      role: "system",
      content:
        "You check generated character images for anatomy errors. Count only body parts attached to the main character, " +
        "including parts partly hidden behind the body if you can see where they attach. Use null when a part is cut off by the frame " +
        "or impossible to count. Count a reflection only once and ignore other people. Never guess. Reply with JSON only.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `The main character is ${who}. Count their ${parts.join(", ")}. ` +
            `Also say whether their whole torso and every limb attachment point is inside the frame. ` +
            `JSON: {${keys}, "torso_fully_visible": boolean}`,
        },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];
}

/** Compare observed counts with the spec. Extra parts always fail; missing ones only when the body is fully in frame. */
export function judgeAnatomy(
  spec: AnatomySpec,
  parts: AnatomyPart[],
  obj: Record<string, unknown> | null,
): AnatomyVerdict {
  if (!obj) return { status: "skipped", reason: "unreadable" };
  const observed: Partial<Record<AnatomyPart, number>> = {};
  const mismatches: AnatomyPart[] = [];
  let score = 0;
  const fullyVisible = obj.torso_fully_visible === true;
  for (const p of parts) {
    const v = obj[p];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 24) continue;
    const n = Math.round(v);
    observed[p] = n;
    const want = spec.counts[p] ?? HUMAN_DEFAULTS[p];
    if (n > want || (n < want && fullyVisible)) {
      mismatches.push(p);
      score += Math.abs(n - want);
    }
  }
  if (mismatches.length) return { status: "mismatch", observed, mismatches, score };
  // No usable count at all (empty / malformed answer, or every part cut off): unchecked, not a pass.
  return Object.keys(observed).length ? { status: "pass", observed } : { status: "skipped", reason: "unreadable" };
}

/** A verifier bound to the Workers AI binding, or one that always skips. */
export function workersAiAnatomyVerifier(args: {
  binding: WorkersAiBinding | undefined;
  config: AnatomyCheckConfig;
  name: string;
  spec: AnatomySpec;
}): AnatomyVerifier {
  const parts = atypicalParts(args.spec);
  const binding = args.binding;
  if (!args.config.enabled) return async () => ({ status: "skipped", reason: "off" });
  if (typeof binding?.run !== "function") return async () => ({ status: "skipped", reason: "no_binding" });
  // Extra arms are a common failure even with a standard body plan.
  const checkParts = parts.includes("arms") ? parts : (["arms", ...parts] as AnatomyPart[]);
  return async (image) => {
    if (!image.bytes.byteLength || image.bytes.byteLength > MAX_CHECK_BYTES) return { status: "skipped", reason: "too_large" };
    const dataUrl = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("anatomy check timed out")), args.config.timeoutMs);
      });
      const out = await Promise.race([
        binding.run(args.config.model, {
          messages: anatomyCheckMessages(args.name, args.spec, checkParts, dataUrl),
          max_tokens: 120,
          temperature: 0,
        }),
        timeout,
      ]);
      return judgeAnatomy(args.spec, checkParts, firstJsonObject(extractWorkersAiText(out)));
    } catch {
      return { status: "skipped", reason: "error" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export type AnatomyCheckResult<T> = {
  result: T;
  attempts: number;
  check: "passed" | "failed" | "skipped" | "off";
  observed?: Partial<Record<AnatomyPart, number>>;
};

/**
 * Render, check, and re-render on a mismatch. `render(attempt)` must use a
 * new seed per attempt. A retry starts only if the remaining time can fit
 * another render plus check (based on the first attempt's duration). If a
 * retry throws (flagged, quota, outage) the best image so far is kept. When
 * every attempt mismatches, the closest one is returned with check=failed so the caller can withhold it.
 */
export async function renderWithAnatomyCheck<T>(args: {
  render: (attempt: number) => Promise<T>;
  bytesOf: (result: T) => Promise<{ bytes: Uint8Array; contentType: string } | null> | { bytes: Uint8Array; contentType: string } | null;
  verify: AnatomyVerifier;
  /** Known up front that no check will run (off / no character subject): render once, no byte reads. */
  skip?: boolean;
  /** Upper bound of one check; a check that could not finish before `deadlineAt` is not started. */
  verifyBudgetMs?: number;
  maxRetries: number;
  deadlineAt?: number;
  now?: () => number;
  onRetry?: (info: { attempt: number; mismatches: AnatomyPart[] }) => void;
}): Promise<AnatomyCheckResult<T>> {
  const now = args.now ?? Date.now;
  const started = now();
  const first = await args.render(0);
  if (args.skip) return { result: first, attempts: 1, check: "off" };
  let best: { result: T; score: number; observed?: Partial<Record<AnatomyPart, number>> } | null = null;
  let current = first;
  let attempts = 1;
  let perAttemptMs = 0;
  const verifyBudget = args.verifyBudgetMs ?? 0;
  for (;;) {
    // Never let the check itself turn a finished photo into a timeout.
    if (args.deadlineAt != null && args.deadlineAt - now() < verifyBudget) {
      return best
        ? { result: best.result, attempts, check: "failed", observed: best.observed }
        : { result: current, attempts, check: "skipped" };
    }
    const image = await args.bytesOf(current);
    const verdict: AnatomyVerdict = image ? await args.verify(image) : { status: "skipped", reason: "unreadable" };
    if (attempts === 1) perAttemptMs = now() - started;
    if (verdict.status === "skipped") {
      // Unchecked (check off, error, timeout): send it as-is. A fresh unchecked
      // retry beats a render already known to have the wrong body.
      return { result: current, attempts, check: verdict.reason === "off" || verdict.reason === "not_needed" ? "off" : "skipped" };
    }
    if (verdict.status === "pass") return { result: current, attempts, check: "passed", observed: verdict.observed };
    if (!best || verdict.score < best.score) best = { result: current, score: verdict.score, observed: verdict.observed };
    const timeLeft = args.deadlineAt == null ? Number.POSITIVE_INFINITY : args.deadlineAt - now();
    if (attempts > args.maxRetries || timeLeft < perAttemptMs * 1.2 + verifyBudget) {
      return { result: best.result, attempts, check: "failed", observed: best.observed };
    }
    args.onRetry?.({ attempt: attempts, mismatches: verdict.mismatches });
    try {
      current = await withinDeadline(args.render(attempts), args.deadlineAt == null ? null : args.deadlineAt - now());
    } catch {
      // Flagged, quota, outage, or the retry ran past the deadline: keep the best render so far.
      return { result: best.result, attempts, check: "failed", observed: best.observed };
    }
    attempts += 1;
  }
}

function withinDeadline<T>(work: Promise<T>, ms: number | null): Promise<T> {
  if (ms == null) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("anatomy retry ran past the photo deadline")), Math.max(0, ms));
  });
  work.catch(() => {});
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function anatomyCheckMetadata(spec: AnatomySpec, outcome: Pick<AnatomyCheckResult<unknown>, "attempts" | "check" | "observed">) {
  return { expected: anatomySummary(spec), check: outcome.check, attempts: outcome.attempts, observed: outcome.observed ?? null };
}
