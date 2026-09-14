/**
 * Novel / extract catalog for the Serenity train track.
 *
 * Weights are replica counts at prepare-finetune time (Unsloth ShareGPT has
 * no sample-weight column). fallen-angel is lore-only: `filterSerenitySft`
 * drops it unless `--include-lore`.
 */

import type { TrainingExample } from "./types";

export type BookId =
  | "anima-protocol"
  | "seraph-code"
  | "fallen-circuit"
  | "slipthk-war"
  | "fallen-angel";

export interface BookSpec {
  id: BookId;
  /** Filename stems we accept (txt/md/pdf). */
  stems: string[];
  /** Replica count in the SFT mix. 0 = exclude from Serenity voice SFT. */
  replicas: number;
  register: string;
  tags: string[];
  /** Human role in the mix. */
  role: "primary-gold" | "secondary" | "spice-low" | "lore-only";
}

export const BOOK_CATALOG: BookSpec[] = [
  {
    id: "anima-protocol",
    stems: ["anima-protocol", "anima_protocol", "anima protocol"],
    replicas: 4,
    register: "gold",
    tags: ["book:anima-protocol", "register:gold", "fear", "choice", "doorway", "synchro", "keys"],
    role: "primary-gold",
  },
  {
    id: "seraph-code",
    stems: ["seraph-code", "seraph_code", "seraph code"],
    replicas: 2,
    register: "clinical-gentle",
    tags: ["book:seraph-code", "register:clinical-gentle"],
    role: "secondary",
  },
  {
    id: "fallen-circuit",
    stems: ["fallen-circuit", "fallen_circuit", "fallen circuit"],
    replicas: 2,
    register: "withholding",
    tags: ["book:fallen-circuit", "register:withholding", "boundaries"],
    role: "secondary",
  },
  {
    id: "slipthk-war",
    stems: ["slipthk-war", "the-slipthk-war", "slipthk_war", "the slipthk war"],
    replicas: 1,
    register: "slipthk",
    tags: ["book:slipthk-war", "register:slipthk", "trust-gated"],
    role: "spice-low",
  },
  {
    id: "fallen-angel",
    stems: ["fallen-angel", "fallen_angel", "fallen angel"],
    replicas: 0,
    register: "world-lore",
    tags: ["book:fallen-angel", "exclude-serenity-sft", "world-lore"],
    role: "lore-only",
  },
];

export const EXCLUDE_SERENITY_SFT_TAG = "exclude-serenity-sft";

const STEM_INDEX = new Map<string, BookSpec>();
for (const spec of BOOK_CATALOG) {
  for (const stem of spec.stems) {
    STEM_INDEX.set(normalizeStem(stem), spec);
  }
}

export function normalizeStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(txt|md|pdf|jsonl|json)$/i, "")
    .replace(/^the-/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function bookSpecForFilename(fileName: string): BookSpec | undefined {
  const stem = normalizeStem(fileName);
  if (STEM_INDEX.has(stem)) return STEM_INDEX.get(stem);
  for (const spec of BOOK_CATALOG) {
    for (const s of spec.stems) {
      const key = normalizeStem(s);
      if (stem.includes(key) || key.includes(stem)) return spec;
    }
  }
  return undefined;
}

export function isExcludedFromSerenitySft(example: TrainingExample): boolean {
  return (example.tags || []).includes(EXCLUDE_SERENITY_SFT_TAG);
}

/** Replica count for SFT mixing. Exclusion is `filterSerenitySft`, not a zero weight. */
export function replicaCount(example: TrainingExample): number {
  if (isExcludedFromSerenitySft(example)) return 1;
  const tags = example.tags || [];
  if (tags.includes("register:slipthk") || tags.includes("book:slipthk-war")) return 1;
  if (tags.includes("book:seraph-code") || tags.includes("book:fallen-circuit")) return 2;
  if (tags.includes("book:anima-protocol") || tags.includes("register:gold")) return 4;
  return 1;
}

export function expandByWeight(examples: TrainingExample[]): TrainingExample[] {
  const out: TrainingExample[] = [];
  for (const example of examples) {
    const n = replicaCount(example);
    for (let i = 0; i < n; i++) {
      out.push(i === 0 ? example : { ...example, id: `${example.id}~w${i}` });
    }
  }
  return out;
}

/**
 * Directories the curator walks, repo-root relative.
 * First file for a given book id wins (txt extracts beat later PDFs/samples).
 */
export const DEFAULT_NOVEL_DIRS = [
  "llm-raw-source",
  "serenity-extract",
  "llm-raw",
  "scripts/llm/data/novels",
  "scripts/llm/data/samples/novels",
];

export function filterSerenitySft(
  examples: TrainingExample[],
  includeLore = false,
): TrainingExample[] {
  if (includeLore) return examples.slice();
  return examples.filter((ex) => !isExcludedFromSerenitySft(ex));
}
