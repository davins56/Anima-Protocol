/**
 * Formatters: Anima TrainingExample → ShareGPT / ChatML / Alpaca / messages.
 */

import type {
  AlpacaExample,
  ChatMlExample,
  ChatTurn,
  ExportFormat,
  PreferenceExample,
  PreferencePairExport,
  ShareGptExample,
  TrainingExample,
} from "./types";

const DEFAULT_INSTRUCTION =
  "Respond as the companion. Stay in character. Honor emotional continuity, " +
  "reference relevant long-term memory naturally, and follow the system / character card.";

/** Build the system message that should sit at the head of every SFT turn. */
export function buildSystemMessage(example: TrainingExample): string {
  if (example.conversation[0]?.role === "system" && example.conversation[0].content.trim()) {
    return example.conversation[0].content.trim();
  }

  const parts: string[] = [];
  const c = example.character;
  parts.push(`You are ${c.name}${c.universe ? ` from ${c.universe}` : ""}.`);
  if (c.voice) parts.push(`Voice: ${c.voice}`);
  if (c.speakingStyle) parts.push(`Speaking style: ${c.speakingStyle}`);
  if (c.personality) parts.push(`Personality: ${c.personality}`);
  if (c.backstory) parts.push(`Backstory: ${c.backstory}`);
  if (c.systemPrompt) parts.push(c.systemPrompt);

  if (example.memory?.length) {
    parts.push(
      "Long-term memory (use when relevant; do not dump all facts):\n" +
        example.memory.map((m) => `• ${m}`).join("\n"),
    );
  }

  if (example.relationship?.tier || example.relationship?.notes) {
    parts.push(
      `Relationship: ${example.relationship.tier || "bonded"}` +
        (example.relationship.notes ? ` — ${example.relationship.notes}` : ""),
    );
  }

  if (example.scenario?.label) {
    parts.push(`Scenario: ${example.scenario.label}`);
  }

  parts.push(example.instruction || DEFAULT_INSTRUCTION);
  return parts.filter(Boolean).join("\n\n");
}

function nonSystemTurns(example: TrainingExample): ChatTurn[] {
  return example.conversation.filter((t) => t.role !== "system");
}

export function toMessages(example: TrainingExample): ChatMlExample {
  const system = buildSystemMessage(example);
  const turns = nonSystemTurns(example);
  return {
    messages: [{ role: "system", content: system }, ...turns],
  };
}

export function toShareGpt(example: TrainingExample): ShareGptExample {
  const system = buildSystemMessage(example);
  const conversations: ShareGptExample["conversations"] = [
    { from: "system", value: system },
  ];
  for (const turn of nonSystemTurns(example)) {
    if (turn.role === "user") {
      conversations.push({ from: "human", value: turn.content });
    } else if (turn.role === "assistant") {
      conversations.push({ from: "gpt", value: turn.content });
    }
  }
  return { conversations, system };
}

/**
 * Alpaca prefers single-turn. We take the last user→assistant pair and fold
 * prior turns into the input context so multi-turn continuity is preserved.
 */
export function toAlpaca(example: TrainingExample): AlpacaExample {
  const system = buildSystemMessage(example);
  const turns = nonSystemTurns(example);
  let lastUserIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const assistant = turns.slice(lastUserIdx + 1).find((t) => t.role === "assistant");
  const prior = turns.slice(0, lastUserIdx);
  const lastUser = turns[lastUserIdx];

  const priorBlock = prior
    .map((t) => `${t.role === "user" ? "User" : "Companion"}: ${t.content}`)
    .join("\n");

  return {
    instruction: example.instruction || DEFAULT_INSTRUCTION,
    input: [priorBlock, lastUser ? `User: ${lastUser.content}` : ""]
      .filter(Boolean)
      .join("\n\n"),
    output: assistant?.content || "",
    system,
  };
}

export function formatExample(
  example: TrainingExample,
  format: ExportFormat,
): ShareGptExample | AlpacaExample | ChatMlExample | TrainingExample {
  switch (format) {
    case "sharegpt":
      return toShareGpt(example);
    case "alpaca":
      return toAlpaca(example);
    case "chatml":
    case "messages":
      return toMessages(example);
    default:
      return example;
  }
}

/** Serialize examples as JSONL for Unsloth / LLaMA-Factory. */
export function toJsonl(
  examples: TrainingExample[],
  format: ExportFormat = "sharegpt",
): string {
  return examples
    .map((ex) => JSON.stringify(formatExample(ex, format)))
    .join("\n")
    .concat(examples.length ? "\n" : "");
}

/**
 * Preference-pair helper for DPO / ORPO / SimPO.
 * `chosen` is the high-quality assistant reply; `rejected` is a weaker one.
 */
export function toPreferencePair(
  example: TrainingExample,
  chosen: string,
  rejected: string,
): PreferencePairExport {
  const system = buildSystemMessage(example);
  const turns = nonSystemTurns(example);
  const lastUser = [...turns].reverse().find((t) => t.role === "user");
  const prior = turns.filter((t) => t !== lastUser && t.role !== "assistant");
  const prompt = [
    ...prior.map((t) => `${t.role}: ${t.content}`),
    lastUser ? `user: ${lastUser.content}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { prompt, chosen, rejected, system };
}

/** Convert a curated `PreferenceExample` into the DPO/ORPO export row. */
export function preferenceToExportRow(pref: PreferenceExample): PreferencePairExport {
  return toPreferencePair(pref.example, pref.chosen, pref.rejected);
}

/** Serialize preference pairs as JSONL (`prompt`/`chosen`/`rejected`/`system` per line). */
export function preferencesToJsonl(preferences: PreferenceExample[]): string {
  return preferences
    .map((p) => JSON.stringify(preferenceToExportRow(p)))
    .join("\n")
    .concat(preferences.length ? "\n" : "");
}
