// Kept in its own module so partial vi.mock()s of openaiClient / llmFailover
// cannot hide the switch.

/** Where the companion "brain" runs its model. */
export type ChatBrainMode = "cloudflare" | "self-hosted";

const CLOUDFLARE_BRAIN_VALUES = new Set([
  "cloudflare",
  "workers-ai",
  "workersai",
  "managed",
]);

/**
 * `ANIMA_CHAT_BRAIN=cloudflare` runs every chat turn and every background
 * brain job (evolution, consolidation, dreams, journal, resting mode,
 * proactive lines) on the Worker's own Workers AI binding. No Fly.io app,
 * DigitalOcean droplet, VPS or tunnel is involved. Unset / `self-hosted`
 * keeps the previous behaviour (prefer ANIMA_LOCAL_LLM_BASE_URL).
 */
export function chatBrainMode(env: NodeJS.ProcessEnv = process.env): ChatBrainMode {
  const raw = (env.ANIMA_CHAT_BRAIN || "").trim().toLowerCase();
  return CLOUDFLARE_BRAIN_VALUES.has(raw) ? "cloudflare" : "self-hosted";
}

export function isCloudflareChatBrain(env: NodeJS.ProcessEnv = process.env): boolean {
  return chatBrainMode(env) === "cloudflare";
}
