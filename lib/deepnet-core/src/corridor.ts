/**
 * The Grey Corridor as data: an ordered run of segments, each a beat of the
 * quest. The 2D page and (later) the 3D scene both render from this.
 */
import type { BandKey } from "@workspace/sim-core";
import type { LoreText } from "./lore";
import type { QuestStep } from "./quest";

export type CorridorSegmentKind = "entry" | "encounter" | "gate" | "exit";

export type CorridorSegment = {
  readonly id: string;
  readonly kind: CorridorSegmentKind;
  readonly label: LoreText;
  /** 0..1 along the corridor. */
  readonly at: number;
  /** The quest step that must already be recorded to reach this segment (null = from the start). */
  readonly requires: QuestStep | null;
};

export type Corridor = {
  readonly id: string;
  readonly nodeId: string;
  readonly questId: string;
  readonly name: LoreText;
  readonly description: LoreText;
  readonly ambientBand: BandKey;
  readonly segments: readonly CorridorSegment[];
};

export function validateCorridor(c: Corridor): string[] {
  const errors: string[] = [];
  const kinds = c.segments.map((s) => s.kind);
  for (const k of ["entry", "encounter", "gate", "exit"] as const) {
    if (kinds.filter((x) => x === k).length !== 1) errors.push(`expected exactly one ${k} segment`);
  }
  for (let i = 1; i < c.segments.length; i++) {
    if (!(c.segments[i].at > c.segments[i - 1].at)) errors.push(`segments out of order at ${c.segments[i].id}`);
  }
  for (const s of c.segments) if (s.at < 0 || s.at > 1) errors.push(`segment ${s.id} out of range`);
  return errors;
}
