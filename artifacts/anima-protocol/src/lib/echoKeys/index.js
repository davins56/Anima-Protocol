// @ts-check
export {
  ECHO_KEY_LIBRARY_SIZE,
  ECHO_KEYS,
  ECHO_KEY_BY_ID,
  getEchoKey,
  echoKeysByFamily,
  echoKeysByClass,
  echoKeysByMemory,
  allEchoKeyIds,
} from "./catalog.js";

export {
  ECHO_FOLDER_RULES,
  makeEchoCopy,
  starterEchoFolder,
  validateEchoFolder,
  drawEchoHand,
} from "./rules.js";

export {
  DEFAULT_FOLDER_ID,
  normalizeEchoKeyAccount,
  activeEchoFolder,
  setFolderSlots,
} from "./account.js";

export { echoKeyToChip, chipsFromEchoFolder } from "./combat.js";

export function echoKeyLoreBlock() {
  return `ECHO KEYS are this world's weapon-memories — 800 distinct ghost programs an operator keeps on their profile. They remix Battle Chip families from Mega Man Battle Network 1–6 (Folder of 30, letter codes, Standard / Apex / Nova, elements, types, Dark and Plus memories) and Star Force card ideas (lock-on Wave memories, Brother Band, Force Big Bang Novas). When slotted, the Anima summons an ethereal weapon: glass-steel, afterimage, no mass.`;
}
