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

/** Compact prompt block for Battle Network / cyberspace story sessions. */
export function energyFragmentLoreBlock() {
  return `ENERGY FRAGMENTS are this world's battle data — ghost programs the operator slots from a Folder. They remix the old Battle Chip families (cannon, sword, bomb, recovery, Navi-sigil) as original Anima data. When summoned, weapons look ethereal: translucent barrels, glass-steel blades, no solid mass, a faint afterimage. Classes: Standard (up to 4 copies), Apex (5 in a Folder), Nova (1). Elements: ember > grove > tide > ember; volt doubles vs tide. Codes A–Z and * link a Custom hand. Named sequences fuse into Resonance Combos (Nova Pulse, Life Veil, Chain Bloom, Prism Storm).`;
}
