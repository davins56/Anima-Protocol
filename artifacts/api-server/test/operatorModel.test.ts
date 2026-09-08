import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  emptyOperatorModel,
  extractOperatorModelFromProfile,
  formatOperatorModelForPrompt,
  mergeOperatorModel,
  normalizeOperatorModel,
  OPERATOR_MODEL_LIMITS,
  operatorModelHasContent,
  parseOperatorModelBody,
} from "../src/lib/operatorModel";

const sourceDir = dirname(fileURLToPath(import.meta.url));

describe("normalizeOperatorModel", () => {
  it("returns empty sections for missing or non-object input", () => {
    expect(normalizeOperatorModel(null)).toEqual(emptyOperatorModel());
    expect(normalizeOperatorModel("nope")).toEqual(emptyOperatorModel());
    expect(normalizeOperatorModel([])).toEqual(emptyOperatorModel());
  });

  it("keeps known fields and drops unknown keys", () => {
    const model = normalizeOperatorModel({
      identity: {
        name: "  Dàvīn  ",
        communication_style: "direct, mythic",
        preferences: ["quiet mornings", 12, ""],
        secret: "drop-me",
      },
      extra_section: { nope: true },
      cognitive: { expertise: ["protocol weaves"], invented: ["no"] },
    });

    expect(model.identity.name).toBe("Dàvīn");
    expect(model.identity.communication_style).toBe("direct, mythic");
    expect(model.identity.preferences).toEqual(["quiet mornings"]);
    expect(model.identity).not.toHaveProperty("secret");
    expect(model).not.toHaveProperty("extra_section");
    expect(model.cognitive.expertise).toEqual(["protocol weaves"]);
    expect(model.cognitive).not.toHaveProperty("invented");
    expect(model.relational.important_people).toEqual([]);
  });

  it("caps string and list sizes", () => {
    const long = "x".repeat(OPERATOR_MODEL_LIMITS.text + 40);
    const model = normalizeOperatorModel({
      identity: {
        name: "n".repeat(OPERATOR_MODEL_LIMITS.name + 20),
        communication_style: long,
        preferences: Array.from({ length: 40 }, (_, i) => `pref-${i}-${long}`),
      },
    });
    expect(model.identity.name.length).toBe(OPERATOR_MODEL_LIMITS.name);
    expect(model.identity.communication_style.length).toBe(
      OPERATOR_MODEL_LIMITS.text,
    );
    expect(model.identity.preferences).toHaveLength(
      OPERATOR_MODEL_LIMITS.listLength,
    );
    expect(
      model.identity.preferences.every(
        (item) => item.length <= OPERATOR_MODEL_LIMITS.listItem,
      ),
    ).toBe(true);
  });
});

describe("mergeOperatorModel + parseOperatorModelBody", () => {
  it("merges provided sections onto the current model", () => {
    const current = normalizeOperatorModel({
      identity: { name: "Dàvīn", preferences: ["tea"] },
      cognitive: { projects: ["Anima Protocol"] },
    });
    const merged = mergeOperatorModel(current, {
      identity: { communication_style: "direct" },
      relational: { important_people: ["Serenity"] },
    });
    expect(merged.identity.name).toBe("Dàvīn");
    expect(merged.identity.preferences).toEqual(["tea"]);
    expect(merged.identity.communication_style).toBe("direct");
    expect(merged.cognitive.projects).toEqual(["Anima Protocol"]);
    expect(merged.relational.important_people).toEqual(["Serenity"]);
  });

  it("unwraps { model } wrappers and accepts a bare object", () => {
    expect(
      normalizeOperatorModel(
        parseOperatorModelBody({ model: { identity: { name: "Aelynd" } } }),
      ).identity.name,
    ).toBe("Aelynd");
    expect(
      normalizeOperatorModel(
        parseOperatorModelBody({ identity: { name: "Dàvīn" } }),
      ).identity.name,
    ).toBe("Dàvīn");
  });
});

describe("formatOperatorModelForPrompt", () => {
  it("returns empty string when the model has no content", () => {
    expect(formatOperatorModelForPrompt(emptyOperatorModel())).toBe("");
    expect(formatOperatorModelForPrompt(null)).toBe("");
    expect(operatorModelHasContent(emptyOperatorModel())).toBe(false);
  });

  it("builds a labeled compact summary and stays within budget", () => {
    const model = normalizeOperatorModel({
      identity: {
        name: "Dàvīn",
        communication_style: "direct, mythic",
        preferences: ["quiet work", "lattice nights"],
      },
      cognitive: { projects: ["Anima Protocol"], expertise: ["systems"] },
      emotional_context: { conversational_tone: "tender-precise" },
    });
    const snippet = formatOperatorModelForPrompt(model);
    expect(snippet).toContain("OPERATOR MODEL (steward / operator context");
    expect(snippet).toContain("do not overwrite CHARACTER IDENTITY LOCK");
    expect(snippet).toContain("name: Dàvīn");
    expect(snippet).toContain("projects: Anima Protocol");
    expect(snippet).toContain("conversational_tone: tender-precise");
    expect(snippet.length).toBeLessThanOrEqual(OPERATOR_MODEL_LIMITS.promptChars);
    expect(snippet).not.toContain("{");
  });

  it("truncates huge models instead of dumping JSON", () => {
    const huge = normalizeOperatorModel({
      identity: {
        name: "Dàvīn",
        preferences: Array.from({ length: 12 }, (_, i) => `preference ${i} ${"word ".repeat(20)}`),
        creative_interests: Array.from({ length: 12 }, (_, i) => `interest ${i} ${"word ".repeat(20)}`),
        long_term_objectives: Array.from({ length: 12 }, (_, i) => `goal ${i} ${"word ".repeat(20)}`),
      },
      cognitive: {
        recurring_concepts: Array.from({ length: 12 }, (_, i) => `concept ${i} ${"word ".repeat(20)}`),
        expertise: Array.from({ length: 12 }, (_, i) => `skill ${i} ${"word ".repeat(20)}`),
        projects: Array.from({ length: 12 }, (_, i) => `project ${i} ${"word ".repeat(20)}`),
      },
    });
    const snippet = formatOperatorModelForPrompt(huge, 400);
    expect(snippet.length).toBeLessThanOrEqual(400);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

describe("extractOperatorModelFromProfile", () => {
  it("reads operator_model from a profile blob", () => {
    const model = extractOperatorModelFromProfile({
      display_name: "steward",
      operator_model: { identity: { name: "Dàvīn" } },
    });
    expect(model.identity.name).toBe("Dàvīn");
    expect(extractOperatorModelFromProfile(null).identity.name).toBe("");
  });
});

describe("chain / provider isolation", () => {
  it("does not import LLM routing or failover modules", () => {
    const source = readFileSync(
      join(sourceDir, "../src/lib/operatorModel.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/llmFailover|modelRouter|ANIMA_LLM_PROVIDER|openaiClient/);
  });
});
