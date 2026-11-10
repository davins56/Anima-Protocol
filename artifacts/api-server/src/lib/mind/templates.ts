/**
 * Model-specific message shaping for hosted chat templates.
 *
 * Workers AI and OpenRouter apply each model's own chat template to the
 * `messages` array, but templates differ in what they accept:
 * - Llama 3.x renders any role sequence, including a short system note
 *   right before the last user turn (kept: it is the strongest steer).
 * - Mistral / Gemma templates require one leading system prompt and strict
 *   user/assistant alternation starting with user; a mid-conversation
 *   system message is rejected or silently dropped.
 * Every family gets: empty messages removed and consecutive same-role turns
 * merged (two user lines in a row otherwise read as one garbled turn).
 */
import type { MindProfile } from "./profile";

export type ShapedMessage = { role: "system" | "user" | "assistant"; content: string };

export const CONTINUE_PLACEHOLDER = "(We were already talking.)";

export function shapeMessagesForModel(
  messages: Array<{ role: string; content: unknown }>,
  profile: Pick<MindProfile, "strictAlternation">,
): ShapedMessage[] {
  const clean: ShapedMessage[] = messages
    .map((m) => ({
      role: (m.role === "system" || m.role === "assistant" ? m.role : "user") as ShapedMessage["role"],
      content: typeof m.content === "string" ? m.content.trim() : String(m.content ?? "").trim(),
    }))
    .filter((m) => m.content);

  const leadSystem: string[] = [];
  let i = 0;
  while (i < clean.length && clean[i]!.role === "system") leadSystem.push(clean[i++]!.content);
  const rest = clean.slice(i);

  const body: ShapedMessage[] = [];
  const foldedSystem: string[] = [];
  for (const m of rest) {
    if (m.role === "system" && profile.strictAlternation) {
      foldedSystem.push(m.content);
      continue;
    }
    const last = body[body.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      body.push({ ...m });
    }
  }

  if (profile.strictAlternation && body[0]?.role === "assistant") {
    body.unshift({ role: "user", content: CONTINUE_PLACEHOLDER });
  }
  // Every template expects the turn to end on the user.
  if (body.length && body[body.length - 1]!.role !== "user") {
    const lastUser = [...body].reverse().find((m) => m.role === "user");
    if (!lastUser) body.push({ role: "user", content: CONTINUE_PLACEHOLDER });
  }

  const system = [...leadSystem, ...(foldedSystem.length ? [`Right now:\n${foldedSystem.join("\n")}`] : [])]
    .join("\n\n")
    .trim();
  return system ? [{ role: "system", content: system }, ...body] : body;
}
