/**
 * Split a multi-speaker conversation so each companion is trained only on
 * their own voice. Other speakers' lines are folded into context on the
 * target character's next reply — never attributed as that character speaking.
 */

import { namesMatch, normalizeCharacterKey } from "./characters";
import type { ChatTurn, TrainingExample } from "./types";

/**
 * Rewrite assistant turns so only `targetName` remains the speaker.
 * Foreign companion / narrator lines are queued and prefixed onto the next
 * target reply. User turns are left untouched.
 */
export function foldForeignSpeakers(turns: ChatTurn[], targetName: string): ChatTurn[] {
  const out: ChatTurn[] = [];
  let pending: string[] = [];
  let sawTarget = false;

  for (const turn of turns) {
    if (turn.role === "system") {
      out.push({ ...turn });
      continue;
    }
    if (turn.role === "user") {
      out.push({ ...turn });
      continue;
    }

    const speaker = turn.name?.trim() || "";
    // Unnamed assistant turns in a solo session belong to the target.
    if (speaker && !namesMatch(speaker, targetName)) {
      pending.push(`[${speaker}]: ${turn.content}`);
      continue;
    }

    sawTarget = true;
    const prefix = pending.length ? `${pending.join("\n")}\n` : "";
    pending = [];
    out.push({
      ...turn,
      content: `${prefix}${turn.content}`,
      name: targetName,
    });
  }

  if (!sawTarget) return [];
  return out;
}

/** One TrainingExample per requested character who actually spoke. */
export function splitExampleByCharacters(
  example: TrainingExample,
  names: string[],
): TrainingExample[] {
  if (!names.length) return [example];
  const out: TrainingExample[] = [];
  for (const name of names) {
    const conversation = foldForeignSpeakers(example.conversation, name);
    if (!conversation.length) continue;
    if (conversation.filter((t) => t.role !== "system").length < 2) continue;
    if (!conversation.some((t) => t.role === "assistant")) continue;
    const slug = normalizeCharacterKey(name) || "companion";
    out.push({
      ...example,
      id: example.id.includes(`:${slug}`) ? example.id : `${example.id}:${slug}`,
      character: { ...example.character, name },
      conversation,
      tags: [...new Set([...(example.tags || []), slug])],
    });
  }
  return out;
}
