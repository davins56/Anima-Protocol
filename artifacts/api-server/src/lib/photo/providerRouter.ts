/**
 * Chooses the generation strategy for an identity-locked photo.
 *
 *  - lora     : character has a trained Flux LoRA (strongest identity lock).
 *  - kontext  : refinement of an existing image (outfit / expression / angle) —
 *               edits the parent image so pose, light and face carry over.
 *  - pulid    : zero-shot identity from the primary face reference (default).
 *  - gemini   : fallback when FAL_KEY is unset (existing Gemini Flash Image
 *               edit path with the reference as the source image).
 *
 * Model ids are env-overridable so a newer fal model can be swapped in without
 * a code change.
 */
import type { Refinement } from "./promptComposer";

export type Strategy = "lora" | "kontext" | "pulid" | "gemini";

export type ProviderConfig = {
  strategy?: Strategy;
  lora_url?: string;
  lora_scale?: number;
  trigger_word?: string;
  id_weight?: number;
  base_seed?: number;
};

export const MODELS = {
  pulid: () => process.env.FAL_PULID_MODEL?.trim() || "fal-ai/flux-pulid",
  lora: () => process.env.FAL_LORA_MODEL?.trim() || "fal-ai/flux-lora",
  kontext: () => process.env.FAL_KONTEXT_MODEL?.trim() || "fal-ai/flux-pro/kontext",
  loraTraining: () => process.env.FAL_LORA_TRAINING_MODEL?.trim() || "fal-ai/flux-lora-fast-training",
};

export function pickStrategy(input: {
  hasFal: boolean;
  config: ProviderConfig;
  refinement?: Refinement;
  hasParentImage: boolean;
  hasReference: boolean;
}): Strategy {
  if (!input.hasFal) return "gemini";
  const op = input.refinement?.op || "new";
  const isEdit = op === "outfit" || op === "expression" || op === "vary_angle" || op === "freeform";
  if (isEdit && input.hasParentImage) return "kontext";
  if (input.config.lora_url) return "lora";
  if (input.hasReference) return "pulid";
  return input.config.strategy === "lora" ? "lora" : "pulid";
}

export type ImageSize = "portrait_4_3" | "portrait_16_9" | "square_hd" | "landscape_4_3" | "landscape_16_9";

export function buildFalRequest(args: {
  strategy: Exclude<Strategy, "gemini">;
  prompt: string;
  negative: string;
  referenceUrl?: string;
  parentImageUrl?: string;
  config: ProviderConfig;
  seed?: number;
  imageSize?: ImageSize;
}): { model: string; input: Record<string, unknown> } {
  const size = args.imageSize || "portrait_4_3";
  const seed = typeof args.seed === "number" ? args.seed : undefined;
  switch (args.strategy) {
    case "kontext":
      return {
        model: MODELS.kontext(),
        input: {
          prompt: args.prompt,
          image_url: args.parentImageUrl,
          seed,
          guidance_scale: 3.5,
          output_format: "jpeg",
          safety_tolerance: "2",
        },
      };
    case "lora":
      return {
        model: MODELS.lora(),
        input: {
          prompt: args.prompt,
          loras: [{ path: args.config.lora_url, scale: args.config.lora_scale ?? 1 }],
          image_size: size,
          num_inference_steps: 28,
          guidance_scale: 3.5,
          seed,
          output_format: "jpeg",
          enable_safety_checker: true,
        },
      };
    case "pulid":
    default:
      return {
        model: MODELS.pulid(),
        input: {
          prompt: args.prompt,
          negative_prompt: args.negative,
          reference_image_url: args.referenceUrl,
          id_weight: args.config.id_weight ?? 1,
          image_size: size,
          num_inference_steps: 20,
          guidance_scale: 4,
          true_cfg: 1,
          seed,
        },
      };
  }
}
