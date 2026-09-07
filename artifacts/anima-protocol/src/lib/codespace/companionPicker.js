import { isPersonalAnimaRecord, selectPersonalAnima } from "@/lib/listPersonalAnimas";
import { expressionBlendLabel } from "@/lib/animaExpressions";
import { JULES_PERSONA } from "./julesApi";

export const COMPANION_KIND = {
  jules: "jules",
  anima: "anima",
  character: "character",
};

const SNIPPET_MAX = 240;

function snippet(value, max = SNIPPET_MAX) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function soulprintSnippet(soulprint) {
  if (!soulprint || typeof soulprint !== "object") return "";
  const parts = [
    soulprint.id,
    soulprint.primary_trait,
    soulprint.secondary_trait,
    soulprint.core_drive,
  ].filter((part) => typeof part === "string" && part.trim());
  return snippet(parts.join(" · "), 200);
}

function expressionSnippet(companion) {
  if (!companion) return "";
  if (typeof companion.expression === "string") return snippet(companion.expression, 80);
  if (companion.expression_spectrum) {
    try {
      return snippet(expressionBlendLabel(companion.expression_spectrum) || "", 80);
    } catch {
      return "";
    }
  }
  return "";
}

export function isAnimaCompanion(companion) {
  if (!companion || companion.id === JULES_PERSONA.id) return false;
  if (companion._companionKind === COMPANION_KIND.anima) return true;
  return companion._isAnima === true || isPersonalAnimaRecord(companion);
}

export function companionPickerLabel(companion) {
  if (!companion) return "Companion";
  if (companion.id === JULES_PERSONA.id || companion._companionKind === COMPANION_KIND.jules) {
    return "⚡ Jules (AI Engineer API)";
  }
  if (isAnimaCompanion(companion)) {
    return `${companion.name || "Anima"} (Anima)`;
  }
  return companion.name || "Companion";
}

export function buildCodespaceCompanions({ animas = [], characters = [] } = {}) {
  const animaIds = new Set((animas || []).map((a) => a?.id).filter(Boolean));
  const roster = (characters || []).filter(
    (c) => c && !animaIds.has(c.id) && !isPersonalAnimaRecord(c),
  );
  return [
    { ...JULES_PERSONA, _companionKind: COMPANION_KIND.jules },
    ...(animas || []).filter(Boolean).map((a) => ({
      ...a,
      _isAnima: true,
      _companionKind: COMPANION_KIND.anima,
    })),
    ...roster.map((c) => ({ ...c, _companionKind: COMPANION_KIND.character })),
  ];
}

/**
 * Restore a saved / deep-linked id when it is still in the roster.
 * Otherwise prefer the assigned personal Anima, then the first Anima, then Jules.
 */
export function resolveCodespaceCompanionId({
  savedId,
  requestedId,
  animas = [],
  characters = [],
  me = null,
} = {}) {
  const companions = buildCodespaceCompanions({ animas, characters });
  const ids = new Set(companions.map((c) => c.id));

  if (requestedId && ids.has(requestedId)) return requestedId;
  if (savedId && ids.has(savedId)) return savedId;

  const anima = selectPersonalAnima(animas, null, me);
  if (anima?.id) return anima.id;
  return JULES_PERSONA.id;
}

export function toCodespaceAgentCharacter(companion) {
  if (!companion) return null;
  const anima = isAnimaCompanion(companion);
  const payload = {
    name: companion.name || "",
    personality: companion.personality || "",
    speaking_style: companion.speaking_style || "",
  };
  if (anima) {
    payload.is_anima = true;
    const soul = soulprintSnippet(companion.soulprint);
    if (soul) payload.soulprint = soul;
    const expression = expressionSnippet(companion);
    if (expression) payload.expression = expression;
    const tagline = snippet(companion.tagline, 160);
    if (tagline) payload.tagline = tagline;
    const archetype = snippet(companion.archetype, 40);
    if (archetype) payload.archetype = archetype;
  }
  return payload;
}
