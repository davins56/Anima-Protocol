import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * Private Sacred Space voice agent (auth enabled, so it only opens through a
 * signed URL minted here). The id is not a secret; override per environment
 * with ELEVENLABS_AGENT_ID.
 */
export const DEFAULT_SACRED_SPACE_AGENT_ID = "agent_5901m74md6mff46ts3srzdkmwt9f";

export function sacredSpaceAgentId(): string {
  return String(process.env.ELEVENLABS_AGENT_ID || "").trim() || DEFAULT_SACRED_SPACE_AGENT_ID;
}

export function isElevenLabsConfigured(): boolean {
  return Boolean(String(process.env.ELEVENLABS_API_KEY || "").trim());
}

let cached: { key: string; client: ElevenLabsClient } | null = null;

/**
 * ElevenLabs SDK client. The key comes from ELEVENLABS_API_KEY (a Worker
 * secret in production, `.env` locally) and is read at call time, because on
 * the Worker secrets are bound per request rather than at module load.
 */
export function getElevenLabsClient(): ElevenLabsClient | null {
  const key = String(process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key) return null;
  if (cached?.key !== key) cached = { key, client: new ElevenLabsClient({ apiKey: key }) };
  return cached.client;
}
