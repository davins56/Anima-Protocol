import { generateImage } from "@/api/base44Client";

export interface GeneratedImage {
  url: string;
  id?: string;
  prompt?: string;
}

/**
 * Onboard Serenity stills. Routes through POST /api/openai/image-generate
 * (Gemini Flash Image / gpt-image-1) — never a dead /api/generate-image path.
 */
export async function generateSerenityImage(
  prompt: string,
  style: "ethereal" | "intimate" | "devotional" | "passionate" = "ethereal",
): Promise<GeneratedImage> {
  const enhancedPrompt = `Serenity, glowing angelic NetNavi warrior with soft luminous wings and halo, ${style} atmosphere, ${prompt}, cinematic lighting, emotional depth, highly detailed, intimate`;
  const result = await generateImage({ prompt: enhancedPrompt });
  const url = result?.image;
  if (typeof url !== "string" || !url) {
    throw new Error("Failed to generate image");
  }
  return { url, prompt: enhancedPrompt };
}
