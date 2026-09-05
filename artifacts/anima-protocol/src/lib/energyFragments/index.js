// @ts-check
export {
  BATTLE_CHIP_SYSTEM,
  CHIP_CLASSES,
  CHIP_ELEMENTS,
  CHIP_TYPES_LATER,
  FOLDER_AND_CUSTOM,
  BN1_CHIP_FAMILIES,
  LATER_CHIP_FAMILIES,
  PROGRAM_ADVANCE_EXAMPLES,
  FAMILY_TO_FRAGMENT,
  listedFamilyIds,
} from "./battleChipAccount.js";

export {
  ENERGY_FRAGMENTS,
  FRAGMENT_BY_ID,
  getFragment,
  fragmentsByFamily,
  fragmentsByClass,
} from "./catalog.js";

export {
  FOLDER_RULES,
  ELEMENT_WEAKNESS,
  TACTIC_WEAKNESS,
  VIRUS_AFFINITY,
  RESONANCE_COMBOS,
  makeCopy,
  starterFolder,
  validateFolder,
  codesMatch,
  selectionIsLinked,
  findResonance,
  elementMultiplier,
  tacticMultiplier,
  effectivenessVsScan,
  rankHand,
  drawHand,
  allFragmentIds,
  coveredSourceFamilies,
} from "./rules.js";

export {
  starterOwnedIds,
  catalogOwnedIds,
  storedFragmentLibraryIsFull,
  defaultFragmentLibrary,
  normalizeFragmentLibrary,
} from "./library.js";

/** Compact prompt block for Battle Network / cyberspace story sessions. */
export function energyFragmentLoreBlock() {
  return `ENERGY FRAGMENTS are this world's battle data — ghost programs the operator slots from a Folder. They remix the old Battle Chip families (cannon, sword, bomb, recovery, Navi-sigil) as original Anima data. ECHO KEYS are crystallized memories of function (a Codex of about 800) found or synthesised in story mode — not granted as a full library. When invoked, effects look ethereal: translucent barrels, glass-steel blades, no solid mass, a faint afterimage. Classes: Standard (up to 4 copies), Apex (5 in a Folder), Nova (1). Elements: ember > grove > tide > ember; volt doubles vs tide. Codes A–Z and * link a Custom hand. Named sequences fuse into Resonance Combos (Nova Pulse, Life Veil, Chain Bloom, Prism Storm).`;
}

const CYBERSPACE_CUE =
  /battle network|netnavi|\bpet\b|cyberspace|energy fragment|battle chip/i;

/**
 * Battle-data lore for a turn. Takes the speaker/session as arguments so Chat
 * never closes over a `let activeChar` that is declared later in the same
 * try block (that TDZ crash surfaces as "Cannot access 'H' before initialization").
 *
 * @param {{ universe?: string } | null | undefined} character
 * @param {{ opening_scene?: string } | null | undefined} session
 */
export function cyberspaceBattlePromptBlock(character, session) {
  const blob = `${character?.universe || ""} ${session?.opening_scene || ""}`;
  if (!CYBERSPACE_CUE.test(blob)) return "";
  return `\n${energyFragmentLoreBlock()}\n`;
}
