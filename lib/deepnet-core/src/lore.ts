/**
 * Lore placeholders. Every name, line and description in the slice is a
 * LORE_TBD entry: a stable key plus neutral stand-in text. Serenity drafts the
 * real text from Shadow Walker and Fallen Circuit and Dàvīn reviews it (#757);
 * nothing here is canon.
 */
export type LoreText = {
  readonly key: string;
  /** Neutral stand-in shown until the drafted text lands. */
  readonly standIn: string;
  readonly tbd: true;
};

const KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function LORE_TBD(key: string, standIn: string): LoreText {
  if (!KEY_RE.test(key)) throw new Error(`Invalid lore key: ${key}`);
  return Object.freeze({ key, standIn, tbd: true as const });
}

/** Text to render. Plain text only: callers must never inject it as HTML. */
export function loreText(t: LoreText): string {
  return t.standIn;
}
