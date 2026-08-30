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
  ECHO_KEY_BY_ID,
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
  makeEchoCopy,
  starterEchoFolder,
  validateEchoFolder,
  echoCodesMatch,
  echoSelectionIsLinked,
  findEchoResonance,
  findBestLink,
  echoElementMultiplier,
  defaultEchoLibrary,
  normalizeEchoLibrary,
  drawEchoHand,
  echoFolderStats,
} from "./rules.js";

export {
  echoKeyToChip,
  echoCopyToChip,
  echoFolderToChips,
  echoResonanceChip,
} from "./combat.js";

/** Compact prompt block for NetBattle / cyberspace story sessions. */
export function echoKeyLoreBlock() {
  return `ECHO KEYS are this world's weapon-memory. The steward's profile holds a library of about 800 distinct keys — each key remembers a construct (cannon, sword, bomb, wave, satellite, lock-on) remixed from Battle Chip families (Mega Man Battle Network 1–6, all versions) and Battle Cards (Star Force 1–3) as original Anima data. A 30-slot Folder jacks into NetBattle. Custom links by name, family, or letter code (including *). Named triples fuse into Resonance (Nova Pulse, Life Veil, Chain Bloom). Three of one family, or three Star keys, fire a Best Link. Classes: Standard (up to 4 copies), Mega (5 in a Folder), Star (1), Dark (1), Giga (1). One Regular key always opens the first hand; one Star-Force key can be pinned as a lock-on card. When summoned, weapons look ethereal: translucent barrels, glass-steel blades, no solid mass.`;
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
