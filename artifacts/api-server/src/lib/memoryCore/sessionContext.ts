/**
 * Session bootstrap for the chat prompt: identity core + ranked memory slice.
 * Called from routes/chat.ts through optionalChatContext with a hard timeout,
 * so a slow or missing memory core never blocks a reply.
 */
import { ensureIdentitySnapshot, recallMemories, type IdentityCore, type RecalledMemory } from "./memoryCore";

export const MEMORY_CORE_TIMEOUT_MS = 1500;
const BLOCK_CHAR_BUDGET = 1800;

export function isMemoryCoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.ANIMA_MEMORY_CORE || "on").trim().toLowerCase();
  return !(raw === "0" || raw === "off" || raw === "false" || raw === "no");
}

function ago(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

export function formatMemoryCoreBlock(identity: IdentityCore | null, memories: RecalledMemory[], now = Date.now()): string {
  const lines: string[] = [];
  if (identity) {
    const traits = Array.isArray(identity.core_traits) ? identity.core_traits.slice(0, 8).map(String).join(", ") : "";
    lines.push(`Identity anchor (v${identity.version}) — you are ${identity.name}.${traits ? ` Core traits: ${traits}.` : ""}`);
  }
  if (memories.length) {
    lines.push("Long-term memories you hold (oldest truths still matter):");
    for (const m of memories) {
      const line = `- (${ago(m.occurred_at, now)}${m.emotional_weight >= 0.8 ? ", deeply felt" : ""}) ${m.content.replace(/\s+/g, " ").trim()}`;
      if (lines.join("\n").length + line.length > BLOCK_CHAR_BUDGET) break;
      lines.push(line);
    }
  }
  return lines.join("\n");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("memory core timeout")), ms)),
  ]);
}

export async function buildMemoryCoreContext(args: {
  userId: string;
  character: { id?: unknown; [k: string]: unknown } | null | undefined;
  query: string;
  sessionId: string;
  limit?: number;
}): Promise<string> {
  if (!isMemoryCoreEnabled() || !args.character?.id) return "";
  return withTimeout(
    (async () => {
      const [identity, memories] = await Promise.all([
        ensureIdentitySnapshot(args.userId, args.character),
        recallMemories({
          userId: args.userId,
          characterId: String(args.character!.id),
          query: args.query,
          limit: args.limit ?? 8,
          sessionId: args.sessionId,
        }),
      ]);
      return formatMemoryCoreBlock(identity, memories);
    })(),
    MEMORY_CORE_TIMEOUT_MS,
  );
}
