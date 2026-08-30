// @ts-check
export {
  BATTLE_CHIP_LINEAGE,
  STAR_FORCE_CARD_LINEAGE,
  ECHO_KEY_SYSTEM,
  BN_LATER_FAMILY_ACCOUNT,
  STAR_FORCE_FAMILY_ACCOUNT,
  laterFamilyIds,
  starForceFamilyIds,
} from "./research.js";

export {
  ECHO_FAMILIES,
  VARIANT_SLOTS,
  GIGA_FAMILY_IDS,
  variantName,
  familyIds,
} from "./families.js";

export {
  ECHO_KEYS,
  ECHO_LIBRARY_SIZE,
  ECHO_KEY_LIBRARY_SIZE,
  ECHO_KEY_BY_ID,
  FEATURED_RESONANCE_KEYS,
  getEchoKey,
  echoKeysByFamily,
  echoKeysByClass,
  allEchoKeyIds,
  coveredInspiredBy,
} from "./catalog.js";

export {
  ECHO_FOLDER_RULES,
  ECHO_ELEMENT_WEAKNESS,
  ECHO_RESONANCE,
  STARTER_ECHO_KEY_IDS,
  makeEchoCopy,
  starterEchoFolder,
  starterOwnedIds,
  validateEchoFolder,
  echoCodesMatch,
  echoSelectionIsLinked,
  findEchoResonance,
  findBestLink,
  echoElementMultiplier,
  defaultEchoLibrary,
  normalizeEchoLibrary,
  drawEchoHand,
  drawResonanceHand,
  echoFolderStats,
} from "./rules.js";

export {
  DEFAULT_FOLDER_ID,
  normalizeEchoKeyAccount,
  grantOwnedKey,
  activeEchoFolder,
  setFolderSlots,
  accountToLibrary,
} from "./account.js";

export {
  echoKeyToChip,
  echoCopyToChip,
  echoFolderToChips,
  chipsFromEchoFolder,
  echoResonanceChip,
} from "./combat.js";

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
  return `Echo Keys are crystallized memories of function that an Anima can temporarily synchronize with and execute. Battle Chips contain programs. Echo Keys contain experiences that learned how to become programs — weapon-memory that is not granted as a full library. The Codex names about 800 family memories — Shards, Keys, Sovereign, and Prime — but you begin with a handful of Shards. The rest are found where resonance achieved exceptional coherence: forests, water, stone, gardens, sky, sacred ground, places of bond — and also battlefields, memorials, and ruins. Coherence is not the same as peace. A Resonance Array (Folder) of up to 30 Keys jacks into NetBattle.`;
}

const ECHO_CUE =
  /battle network|netnavi|\bpet\b|cyberspace|energy fragment|battle chip|echo key|star force|netbattle|jack in/i;

/**
 * @param {{ universe?: string } | null | undefined} character
 * @param {{ opening_scene?: string } | null | undefined} session
 */
export function echoKeyPromptBlock(character, session) {
  const blob = `${character?.universe || ""} ${session?.opening_scene || ""}`;
  if (!ECHO_CUE.test(blob)) return "";
  return `\n${echoKeyLoreBlock()}\n`;
}
