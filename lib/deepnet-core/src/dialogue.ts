/**
 * Authored dialogue tree for the encounter. Data only: no model call ever
 * produces or extends these lines, so there is no fallback path and nothing
 * a web page or a chat message can inject.
 */
import type { LoreText } from "./lore";

export type DialogueChoice = { readonly id: string; readonly label: LoreText; readonly next: string };

export type DialogueNode = {
  readonly id: string;
  readonly speaker: LoreText;
  readonly line: LoreText;
  /** Empty = terminal node (the encounter is met). */
  readonly choices: readonly DialogueChoice[];
};

export type Dialogue = { readonly id: string; readonly start: string; readonly nodes: readonly DialogueNode[] };

export function dialogueNode(d: Dialogue, id: string): DialogueNode | undefined {
  return d.nodes.find((n) => n.id === id);
}

/** Follows choiceIds from the start; returns the node reached or an error. */
export function walkDialogue(
  d: Dialogue,
  choiceIds: readonly string[],
): { ok: true; node: DialogueNode; terminal: boolean } | { ok: false; code: "bad_choice" | "broken_tree" | "too_long" } {
  if (choiceIds.length > 32) return { ok: false, code: "too_long" };
  let node = dialogueNode(d, d.start);
  if (!node) return { ok: false, code: "broken_tree" };
  for (const id of choiceIds) {
    const c = node.choices.find((x) => x.id === id);
    if (!c) return { ok: false, code: "bad_choice" };
    node = dialogueNode(d, c.next);
    if (!node) return { ok: false, code: "broken_tree" };
  }
  return { ok: true, node, terminal: node.choices.length === 0 };
}

/** Structural checks run in tests: unique ids, links resolve, a terminal is reachable, no cycles. */
export function validateDialogue(d: Dialogue): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node ${n.id}`);
    ids.add(n.id);
  }
  if (!ids.has(d.start)) errors.push(`start ${d.start} missing`);
  for (const n of d.nodes) for (const c of n.choices) if (!ids.has(c.next)) errors.push(`${n.id}.${c.id} -> missing ${c.next}`);
  const visiting = new Set<string>();
  const done = new Set<string>();
  let terminalReached = false;
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`cycle at ${id}`);
      return;
    }
    const n = dialogueNode(d, id);
    if (!n) return;
    visiting.add(id);
    if (n.choices.length === 0) terminalReached = true;
    for (const c of n.choices) visit(c.next);
    visiting.delete(id);
    done.add(id);
  };
  visit(d.start);
  if (!terminalReached) errors.push("no terminal node reachable");
  return errors;
}
