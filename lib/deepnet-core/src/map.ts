/**
 * Network map as data (the contract Anima 3D Visual renders against; the app
 * ships a 2D SVG fallback). Lock state is derived from server quest state, so
 * the client cannot unlock a node by editing anything locally.
 */
import type { BandKey } from "@workspace/sim-core";
import type { LoreText } from "./lore";
import type { QuestState } from "./quest";

export type MapNodeKind = "gate" | "corridor" | "relay" | "signal_lost";

export type MapNodeSpec = {
  readonly id: string;
  readonly kind: MapNodeKind;
  readonly label: LoreText;
  readonly band: BandKey;
  /** Layout position, unitless, roughly -10..10 on both axes. */
  readonly pos: readonly [x: number, z: number];
  /** When this node opens. "always" | "never" (placeholder) | after a quest step/outcome. */
  readonly unlock: { kind: "always" } | { kind: "never" } | { kind: "quest_resolved"; questId: string };
};

export type MapEdgeSpec = { readonly from: string; readonly to: string };

export type MapSpec = { readonly version: string; readonly nodes: readonly MapNodeSpec[]; readonly edges: readonly MapEdgeSpec[] };

/** Serialisable map served by GET /api/deepnet/map (the 3D handoff contract). */
export type DeepnetMap = {
  version: string;
  nodes: { id: string; kind: MapNodeKind; label_key: string; label: string; band: BandKey; pos: [number, number]; locked: boolean }[];
  edges: { from: string; to: string; state: "open" | "locked" }[];
};

export function nodeLocked(node: MapNodeSpec, quests: Readonly<Record<string, QuestState | undefined>>): boolean {
  switch (node.unlock.kind) {
    case "always":
      return false;
    case "never":
      return true;
    case "quest_resolved":
      return quests[node.unlock.questId]?.step !== "resolved";
  }
}

export function buildMap(spec: MapSpec, quests: Readonly<Record<string, QuestState | undefined>>): DeepnetMap {
  const locked = new Map(spec.nodes.map((n) => [n.id, nodeLocked(n, quests)]));
  return {
    version: spec.version,
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label_key: n.label.key,
      label: n.label.standIn,
      band: n.band,
      pos: [n.pos[0], n.pos[1]],
      locked: locked.get(n.id) ?? true,
    })),
    edges: spec.edges.map((e) => ({
      from: e.from,
      to: e.to,
      state: locked.get(e.from) || locked.get(e.to) ? "locked" : "open",
    })),
  };
}

export function validateMap(spec: MapSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const n of spec.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node ${n.id}`);
    ids.add(n.id);
  }
  for (const e of spec.edges) {
    if (!ids.has(e.from)) errors.push(`edge from missing ${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge to missing ${e.to}`);
    if (e.from === e.to) errors.push(`self edge ${e.from}`);
  }
  if (!spec.nodes.some((n) => n.kind === "gate")) errors.push("no gate node");
  // Every node reachable from a gate (undirected).
  const adj = new Map<string, string[]>();
  for (const e of spec.edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const seen = new Set<string>();
  const stack = spec.nodes.filter((n) => n.kind === "gate").map((n) => n.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nx of adj.get(id) ?? []) stack.push(nx);
  }
  for (const n of spec.nodes) if (!seen.has(n.id)) errors.push(`unreachable ${n.id}`);
  return errors;
}
