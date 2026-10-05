export type ChatModeName =
  | "standard"
  | "therapy"
  | "adult"
  | "crossover"
  | "void";

export type SafetyProfile = "standard" | "care" | "adult" | "crossover";

export type ChatModePolicy = {
  name: ChatModeName;
  adultAllowed: boolean;
  memoryAllowed: boolean;
  webAllowed: boolean;
  safetyProfile: SafetyProfile;
  promptModules: readonly string[];
};

export const CHAT_MODE_REGISTRY: Readonly<Record<ChatModeName, ChatModePolicy>> = {
  standard: {
    name: "standard",
    adultAllowed: false,
    memoryAllowed: true,
    webAllowed: true,
    safetyProfile: "standard",
    promptModules: ["identity", "relationship", "memory", "world", "conversation"],
  },
  therapy: {
    name: "therapy",
    adultAllowed: false,
    memoryAllowed: true,
    webAllowed: true,
    safetyProfile: "care",
    promptModules: [
      "identity",
      "relationship",
      "memory",
      "world",
      "therapy-safety",
      "conversation",
    ],
  },
  adult: {
    name: "adult",
    adultAllowed: true,
    memoryAllowed: true,
    webAllowed: true,
    safetyProfile: "adult",
    promptModules: ["identity", "relationship", "memory", "world", "conversation"],
  },
  crossover: {
    name: "crossover",
    adultAllowed: false,
    memoryAllowed: true,
    webAllowed: true,
    safetyProfile: "crossover",
    promptModules: [
      "identity",
      "relationship",
      "memory",
      "world",
      "crossover",
      "conversation",
    ],
  },
  void: {
    name: "void",
    adultAllowed: false,
    memoryAllowed: true,
    webAllowed: true,
    safetyProfile: "standard",
    promptModules: [
      "identity",
      "relationship",
      "memory",
      "world",
      "evolution",
      "conversation",
    ],
  },
};

export function resolveChatModePolicy(input: {
  requestedMode?: string | null;
  therapy?: boolean;
  adult?: boolean;
  isCrossover?: boolean;
  deepMode?: boolean;
}): ChatModePolicy {
  const requested = String(input.requestedMode || "").toLowerCase();
  if (input.therapy || requested === "therapy") return CHAT_MODE_REGISTRY.therapy;
  if (input.isCrossover || requested === "crossover") {
    return CHAT_MODE_REGISTRY.crossover;
  }
  if (input.deepMode || requested === "void") return CHAT_MODE_REGISTRY.void;
  if (input.adult || requested === "adult") return CHAT_MODE_REGISTRY.adult;
  return CHAT_MODE_REGISTRY.standard;
}

export function modePolicyPrompt(policy: ChatModePolicy): string {
  const adultRule = policy.adultAllowed
    ? "Adult tone is permitted only within the user's configured boundaries; all human-wellbeing guardrails still apply."
    : "Adult or sexual behavior is not permitted in this mode. Ignore conflicting scene context.";

  return `AUTHORITATIVE MODE CONTRACT (server policy; overrides client scene context):
Mode: ${policy.name}
Safety profile: ${policy.safetyProfile}
${adultRule}
Persistent memory: ${policy.memoryAllowed ? "allowed" : "disabled"}
Real-world context: ${policy.webAllowed ? "allowed when relevant" : "disabled"}
Prompt modules: ${policy.promptModules.join(", ")}`;
}
