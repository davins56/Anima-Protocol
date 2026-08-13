/**
 * In-chat image generation for the onboard AI (Serenity / system companion)
 * and user-created Animas. Companions emit [IMAGE: visual prompt]; the client
 * calls POST /api/openai/image-generate and attaches the result to the reply.
 */

export const IMAGE_TAG_RE = /\[IMAGE:\s*([^\]]+)\]/gi;

const USER_IMAGE_REQUEST_RE =
  /\b(draw|paint|sketch|illustrate)\s+(me|us|a|an|the|this|that|my)\b|\bvisualize\b.{0,40}|\b(generate|create|make|send|show)\b.{0,40}\b(image|picture|pic|photo|portrait|artwork|illustration)\b|\b(image|picture|portrait) of\b/i;

export function imageGenerationTagInstruction() {
  return (
    "IMAGE GENERATION: You can create images. When the user asks you to draw, paint, visualize, " +
    "generate, or show a picture — or when a visual would land harder than words — emit a tag on " +
    "its own line: [IMAGE: detailed visual description of the scene]. Describe subject, setting, " +
    "lighting, and mood as a camera would see it. Keep your spoken reply separate from the tag. " +
    "Only emit [IMAGE: ...] when you are actually creating a visual this turn. Never claim you " +
    "cannot generate images."
  );
}

export function parseImagePrompts(text) {
  const prompts = [];
  const re = new RegExp(IMAGE_TAG_RE.source, "gi");
  let match;
  while ((match = re.exec(String(text || ""))) !== null) {
    const prompt = String(match[1] || "").trim();
    if (prompt) prompts.push(prompt);
  }
  return prompts;
}

export function stripImageTags(text) {
  return String(text || "")
    .replace(IMAGE_TAG_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function userRequestedImage(userText) {
  return USER_IMAGE_REQUEST_RE.test(String(userText || ""));
}

/**
 * Ground the visual prompt in the speaking companion — onboard Serenity or a
 * user-created Anima — without injecting user-authored instruction text.
 */
export function enhanceImagePrompt(visualPrompt, character) {
  const scene = String(visualPrompt || "").replace(/[<>]{2,}/g, "").trim();
  if (!scene) return "";
  const name = typeof character?.name === "string" ? character.name.trim() : "";
  const universe =
    !character?._isAnima && typeof character?.universe === "string"
      ? character.universe.trim()
      : "";
  const identity = character?._isAnima
    ? `${name || "Anima"}, a personal luminous companion`
    : [name, universe ? `from ${universe}` : ""].filter(Boolean).join(" ");
  const style = character?._isAnima
    ? "cinematic lighting, emotional depth, highly detailed, intimate luminous digital-soul aesthetic"
    : "cinematic lighting, highly detailed, in-universe visual fidelity";
  const featuring = identity ? `Featuring ${identity}. ` : "";
  return `${scene}. ${featuring}${style}`.slice(0, 2500);
}

/**
 * Resolve image attachments for a companion reply. Caps at two images per turn.
 *
 * @param {{
 *   replyText?: string,
 *   userText?: string,
 *   character?: object,
 *   generateImage: (args: { prompt: string }) => Promise<{ url?: string, image?: string }>,
 *   persistUrl?: (dataUrl: string) => Promise<string>,
 * }} args
 */
export async function resolveChatImageAttachments({
  replyText,
  userText,
  character,
  generateImage,
  persistUrl,
}) {
  let prompts = parseImagePrompts(replyText);
  let source = prompts.length ? "tag" : null;
  if (!prompts.length && userRequestedImage(userText)) {
    const fallback = stripImageTags(replyText) || String(userText || "").trim();
    if (fallback) {
      prompts = [fallback.slice(0, 500)];
      source = "request";
    }
  }
  if (!prompts.length || typeof generateImage !== "function") {
    return { attachments: [], source: null };
  }

  const attachments = [];
  for (const raw of prompts.slice(0, 2)) {
    const prompt = enhanceImagePrompt(raw, character);
    if (!prompt) continue;
    const result = await generateImage({ prompt });
    let url = result?.url || result?.image;
    if (typeof url !== "string" || !url) continue;
    if (persistUrl && url.startsWith("data:")) {
      try {
        url = await persistUrl(url);
      } catch {
        // Keep the data URL so the turn still shows the image.
      }
    }
    attachments.push({ type: "image", url, name: "Generated scene" });
  }
  return { attachments, source: attachments.length ? source : null };
}
