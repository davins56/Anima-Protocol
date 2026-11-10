/**
 * Which mind profile applies to this turn. Reads the live provider chain so
 * the prompt is sized for the model that will actually answer.
 */
import { getProviderChain, resolveOpenRouterModel } from "../llmFailover";
import type { ModelTier } from "../modelRouter";
import { workersAiChatModel } from "../workersAi";
import { mindProfileFor, type MindProfile } from "./profile";

export function activeChatModel(tier: ModelTier = "standard"): { provider: string | null; model: string | null } {
  const provider = getProviderChain()[0] ?? null;
  if (provider === "workersai") return { provider, model: workersAiChatModel() };
  if (provider === "openrouter") {
    try {
      return { provider, model: resolveOpenRouterModel(tier).model };
    } catch {
      return { provider, model: null };
    }
  }
  return { provider, model: null };
}

export function activeMindProfile(tier: ModelTier = "standard"): MindProfile | null {
  try {
    const { provider, model } = activeChatModel(tier);
    return mindProfileFor(provider, model);
  } catch {
    // A misconfigured chain (or a partial test mock) keeps the legacy path.
    return null;
  }
}

/** True when another provider can still answer after `excluded`. */
export function hasAlternativeProvider(excluded: string[]): boolean {
  const skip = new Set(excluded);
  try {
    return getProviderChain().some((p) => !skip.has(p));
  } catch {
    return false;
  }
}
