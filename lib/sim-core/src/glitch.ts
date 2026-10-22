/**
 * Deterministic "corrupted signal" rendering for text: used for glitched
 * memories (UI + obscured prompt fragments) and Serenity's comms at low clarity.
 * Never alters stored data — it's a view.
 */
import { hashString } from "./rng";

const BLOCKS = ["▓", "▒", "░", "█"];

/** Replace roughly `amount` (0–1) of the words with static blocks, stable for the same input. */
export function glitchText(text: string, amount: number, salt = ""): string {
  const a = Math.min(1, Math.max(0, amount));
  if (a <= 0) return text;
  let i = 0;
  return text.replace(/\S+/g, (word) => {
    const h = parseInt(hashString(`${salt}:${i++}:${word}`), 16) / 0xffffffff;
    if (h >= a) return word;
    return Array.from(word, (_, k) => BLOCKS[(k + (h * 97) | 0) % BLOCKS.length]).join("");
  });
}

/** Prompt-safe fragment of a corrupted memory: severity 0.35 → ~35% of words lost. */
export function obscuredMemory(content: string, severity: number, id = ""): string {
  return `[signal corrupted · ${Math.round(severity * 100)}%] ${glitchText(content, severity, id)}`;
}
