import type { ChatMessage } from "../types/index.js";

export function normalizeMessages(input: ChatMessage[], maxMessages: number, maxChars: number): ChatMessage[] {
  return input
    .filter((message) =>
      ["system", "user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.trim().length > 0,
    )
    .slice(-maxMessages)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, maxChars),
    }));
}
