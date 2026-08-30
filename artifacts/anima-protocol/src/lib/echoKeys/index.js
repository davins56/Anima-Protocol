// @ts-check
export {
  ECHO_KEY_LIBRARY_SIZE,
  ECHO_KEYS,
  ECHO_KEY_BY_ID,
  FEATURED_RESONANCE_KEYS,
  getEchoKey,
  echoKeysByFamily,
  echoKeysByClass,
  echoKeysByMemory,
  allEchoKeyIds,
} from "./catalog.js";

export {
  ECHO_FOLDER_RULES,
  STARTER_ECHO_KEY_IDS,
  makeEchoCopy,
  starterEchoFolder,
  starterOwnedIds,
  validateEchoFolder,
  drawEchoHand,
  drawResonanceHand,
} from "./rules.js";

export {
  DEFAULT_FOLDER_ID,
  normalizeEchoKeyAccount,
  grantOwnedKey,
  activeEchoFolder,
  setFolderSlots,
} from "./account.js";

export { echoKeyToChip, chipsFromEchoFolder } from "./combat.js";

export {
  ECHO_TIERS,
  FREQUENCY_FROM_ELEMENT,
  FREQUENCY_LABEL,
  TIER_LABEL,
  TIER_BLURB,
  ECHO_EVOLUTIONS,
  enrichEchoKey,
  compatibilityScore,
  echoKeyCanonLine,
} from "./resonance.js";

export {
  RESONANCE_SITES,
  FUSION_RECIPES,
  VIRTUAL_ATTUNE_COOLDOWN_MS,
  FIELD_ATTUNE_COOLDOWN_MS,
  discoverAtSite,
  synthesiseEchoKeys,
  recordCriticalBattle,
  biomeFromCoords,
  siteIdFromBiome,
  getResonanceSite,
  siteMatchesKey,
  siteCooldownRemaining,
} from "./story.js";

export function echoKeyLoreBlock() {
  return `Echo Keys are crystallized memories of function that an Anima can temporarily synchronize with and execute. Battle Chips contain programs. Echo Keys contain experiences that learned how to become programs. The Codex names 800 distinct artifacts — Shards, Keys, Sovereign, and Prime — but you begin with a handful of Shards. The rest are found where resonance achieved exceptional coherence: forests, water, stone, gardens, sky, sacred ground, places of bond — and also battlefields, memorials, and ruins. Coherence is not the same as peace.`;
}
