/**
 * Builds identity-locked, photoreal prompts. The identity descriptor is always
 * emitted first and verbatim so every generation carries the same face/body
 * anchors; the scene (user language + structured chips) varies around it.
 */

export type VisualDescriptor = {
  age_range?: string;
  ethnicity?: string;
  skin_tone?: string;
  face_shape?: string;
  eye_color?: string;
  eye_shape?: string;
  hair_color?: string;
  hair_style?: string;
  body_type?: string;
  height?: string;
  distinguishing_marks?: string[];
  signature_outfit?: string;
  style?: "photoreal" | "cinematic" | "anime" | string;
  /** Free-form extra anchors, e.g. from a 3D vessel descriptor. */
  extra?: string[];
};

export type SceneSpec = {
  setting?: string;
  mood?: string;
  lighting?: string;
  composition?: string;
  camera?: string;
  outfit?: string;
  expression?: string;
  angle?: string;
};

export type RefinementOp = "new" | "regenerate" | "vary_angle" | "outfit" | "expression" | "freeform";

export type Refinement = { op: RefinementOp; value?: string };

const MAX = 1800;

function clean(v: unknown, max = 240): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function identityAnchor(name: string, d: VisualDescriptor, triggerWord?: string): string {
  const parts = [
    triggerWord ? clean(triggerWord, 40) : "",
    clean(name, 60),
    d.age_range && `${clean(d.age_range, 40)} years old`,
    clean(d.ethnicity),
    d.skin_tone && `${clean(d.skin_tone)} skin`,
    d.face_shape && `${clean(d.face_shape)} face`,
    d.eye_color && `${clean(d.eye_color)}${d.eye_shape ? ` ${clean(d.eye_shape)}` : ""} eyes`,
    d.hair_color || d.hair_style ? `${clean(d.hair_color)} ${clean(d.hair_style)} hair`.trim() : "",
    d.body_type && `${clean(d.body_type)} build`,
    ...(Array.isArray(d.distinguishing_marks) ? d.distinguishing_marks.map((m) => clean(m, 80)) : []),
    ...(Array.isArray(d.extra) ? d.extra.map((m) => clean(m, 120)) : []),
  ].filter(Boolean);
  return parts.join(", ");
}

const STYLE_SUFFIX: Record<string, string> = {
  photoreal:
    "photorealistic, natural skin texture with pores, realistic subsurface scattering, shot on 85mm f/1.8, shallow depth of field, true-to-life color, sharp focus on eyes",
  cinematic:
    "cinematic still, photorealistic, anamorphic lens, film grain, motivated lighting, color graded, sharp focus on eyes",
  anime: "high quality anime key visual, clean line art, consistent character design",
};

export function refinementClause(ref: Refinement | undefined): string {
  if (!ref || ref.op === "new" || ref.op === "regenerate") return "";
  const v = clean(ref.value, 200);
  switch (ref.op) {
    case "vary_angle":
      return `Same person, same outfit and setting, new camera angle: ${v || "three-quarter view from a slightly different side"}.`;
    case "outfit":
      return `Same person and pose, change only the outfit to: ${v || "a different outfit"}.`;
    case "expression":
      return `Same person, outfit and framing, change only the facial expression to: ${v || "a soft genuine smile"}.`;
    case "freeform":
      return v ? `Keep the same person; change: ${v}.` : "";
    default:
      return "";
  }
}

export function composePhotoPrompt(input: {
  characterName: string;
  descriptor: VisualDescriptor;
  userPrompt?: string;
  scene?: SceneSpec;
  refinement?: Refinement;
  triggerWord?: string;
}): string {
  const d = input.descriptor || {};
  const s = input.scene || {};
  const anchor = identityAnchor(input.characterName, d, input.triggerWord);
  const outfit = clean(s.outfit) || clean(d.signature_outfit);
  const sceneBits = [
    clean(input.userPrompt, 600),
    s.setting && `setting: ${clean(s.setting)}`,
    outfit && `wearing ${outfit}`,
    s.expression && `expression: ${clean(s.expression)}`,
    s.mood && `mood: ${clean(s.mood)}`,
    s.lighting && `lighting: ${clean(s.lighting)}`,
    s.composition && `composition: ${clean(s.composition)}`,
    s.camera && `camera: ${clean(s.camera)}`,
    s.angle && `angle: ${clean(s.angle)}`,
  ].filter(Boolean);
  const style = STYLE_SUFFIX[String(d.style || "photoreal")] || STYLE_SUFFIX.photoreal;
  return [
    `Portrait photo of ${anchor}.`,
    refinementClause(input.refinement),
    sceneBits.join(", "),
    "Identity must match the reference face exactly: same facial structure, eye color, skin tone and hairline.",
    style,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX);
}

export function negativePrompt(extra?: string): string {
  return [
    "different person, face swap artifacts, deformed face, asymmetrical eyes, extra fingers, plastic skin, airbrushed, cartoon, 3d render, watermark, text",
    clean(extra, 400),
  ]
    .filter(Boolean)
    .join(", ");
}
