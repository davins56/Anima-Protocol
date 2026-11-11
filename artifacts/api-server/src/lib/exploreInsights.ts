/**
 * Pure helpers behind the Explore-page RPCs. Kept free of DB, model and Clerk
 * imports so they can be unit-tested directly.
 */

/** Parse model output that should be JSON but may arrive fenced or chatty. */
export function parseJsonLoose<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) return fallback;
  const start = Math.min(...starts);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (end <= start) return fallback;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}

export type InventoryStatKey =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

const RARITY_POWER: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  legendary: 5,
};

const TYPE_STAT: Record<string, InventoryStatKey> = {
  weapon: "strength",
  armor: "constitution",
  gear: "dexterity",
  consumable: "wisdom",
  artifact: "intelligence",
  misc: "charisma",
};

export type InventoryStats = {
  stats: Record<InventoryStatKey, number>;
  equipped_items: Record<string, unknown>[];
  effects: string[];
  total_value: number;
};

/**
 * Derive equipped-stat totals from the bag. Inventory rows carry no stat
 * sheet of their own, so power comes from rarity and the stat from item type —
 * the same mapping the item labels imply.
 */
export function computeInventoryStats(
  items: Record<string, unknown>[],
): InventoryStats {
  const stats: Record<InventoryStatKey, number> = {
    strength: 0,
    dexterity: 0,
    constitution: 0,
    intelligence: 0,
    wisdom: 0,
    charisma: 0,
  };
  const effects: string[] = [];
  const equipped_items: Record<string, unknown>[] = [];
  let total_value = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    // A row with no name is not an item the player can see or carry.
    if (!String(item.name ?? "").trim()) continue;
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const rarity = String(item.rarity ?? "common").trim().toLowerCase();
    const type = String(item.type ?? "misc").trim().toLowerCase();
    const power = RARITY_POWER[rarity] ?? 1;
    const stat = TYPE_STAT[type] ?? "charisma";

    // Only worn/held items change stats; everything still has trade value.
    if (item.equipped) {
      stats[stat] += power * quantity;
      equipped_items.push(item);
      if (rarity === "legendary" || rarity === "rare") {
        effects.push(`${String(item.name ?? "Item")} · ${rarity}`);
      }
    }
    total_value += power * quantity;
  }

  return { stats, equipped_items, effects, total_value };
}

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length >= 3);
}

/**
 * Lexical recall over stored vector memories. Deliberately model-free: recall
 * runs behind an open chat turn and must never take the companion's slot.
 */
export function scoreMemories(
  query: string,
  memories: Record<string, unknown>[],
  options: { limit?: number; threshold?: number } = {},
): Record<string, unknown>[] {
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 8));
  const threshold = Math.min(1, Math.max(0, Number(options.threshold) || 0.5));
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  return (Array.isArray(memories) ? memories : [])
    .map((memory) => {
      const haystack = new Set(
        tokenize(
          [
            memory?.title,
            memory?.subject,
            memory?.content,
            memory?.description,
            Array.isArray(memory?.related_events) ? memory.related_events.join(" ") : "",
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
      const hits = terms.filter((term) => haystack.has(term)).length;
      return { memory, score: hits / terms.length };
    })
    .filter(({ memory, score }) => Boolean(memory) && score > 0 && score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ memory, score }) => ({
      ...memory,
      similarity_score: Math.round(score * 100) / 100,
    }));
}

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  description: string;
};

export type GraphEdge = { source: string; target: string; relation: string };

/** Project stored entities into the node/edge shape the graph viewer renders. */
export function matchGraphNodes(
  query: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  limit = 10,
): Array<{
  entity: string;
  type: string;
  description: string;
  connected_entities: Array<{ label: string; relation: string }>;
}> {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return nodes
    .filter((node) =>
      `${node.label} ${node.description}`.toLowerCase().includes(needle),
    )
    .slice(0, Math.max(1, limit))
    .map((node) => ({
      entity: node.label,
      type: node.type,
      description: node.description,
      connected_entities: edges
        .filter((edge) => edge.source === node.id || edge.target === node.id)
        .map((edge) => {
          const otherId = edge.source === node.id ? edge.target : edge.source;
          return {
            label: byId.get(otherId)?.label ?? otherId,
            relation: edge.relation,
          };
        })
        .slice(0, 5),
    }));
}
