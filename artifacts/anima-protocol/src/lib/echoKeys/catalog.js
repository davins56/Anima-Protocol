// @ts-check
/**
 * Echo Keys — original Anima Protocol battle data.
 *
 * Each key is a crystallized harmonic instruction — an executable resonance
 * artifact an Anima can synchronize with. Combat is one possible execution.
 * The Codex holds ~800 distinct keys; operators find, synthesise, or evolve
 * them in story mode instead of receiving the library on day one.
 *
 * Design pointers (research only — no Capcom names or art as playable rows):
 * - Battle Network 1–6: Folder of 30, codes A–Z + *, Standard / Mega / Giga,
 *   elements, types, Program Advances, Navi chips, Dark chips, Plus chips
 * - Star Force 1–3: Battle Cards, lock-on, Brother Band, Force Big Bang
 *
 * Playable names stay original (Energy Fragment lineage + new memories).
 */

import { ENERGY_FRAGMENTS } from "../energyFragments/catalog.js";

/** Target distinct keys a profile can hold. */
export const ECHO_KEY_LIBRARY_SIZE = 800;

/** @typedef {"standard" | "apex" | "nova"} EchoClass */
/** @typedef {"void" | "ember" | "tide" | "volt" | "grove"} EchoElement */
/** @typedef {"none" | "blade" | "gale" | "mark" | "shatter" | "summon" | "mend"} EchoTactic */
/**
 * @typedef {"weapon" | "plus" | "field" | "dark" | "wave" | "brother" | "nova"} EchoMemory
 */
/** @typedef {"bn1" | "bn2" | "bn3" | "bn4" | "bn5" | "bn6" | "starforce"} EchoEra */

/**
 * @typedef {object} EchoKey
 * @property {string} id
 * @property {string} name
 * @property {number} libraryNo
 * @property {string} family
 * @property {EchoClass} class
 * @property {EchoElement} element
 * @property {EchoTactic} tactic
 * @property {number | null} power
 * @property {number} mb
 * @property {string[]} codes
 * @property {string} description
 * @property {string} summon
 * @property {string} inspiredByFamily
 * @property {EchoMemory} memory
 * @property {EchoEra} era
 * @property {number} [hits]
 * @property {string} [originSite]
 * @property {string} [memoryText]
 */

/**
 * Story-mode featured Keys. These are named artifacts, not shop goods.
 * Sovereign / Prime cosmological Keys from Fallen Circuit stay out of this list.
 */
export const FEATURED_RESONANCE_KEYS = [
  {
    id: "last-ember",
    name: "Last Ember",
    family: "featured",
    class: "standard",
    element: "ember",
    tactic: "none",
    power: 90,
    mb: 18,
    codes: ["L", "E", "*"],
    description:
      "Final surviving flame of a destroyed settlement. Invokes three resonance flames. Passive: output rises when the Anima's integrity falls below 30%.",
    summon: "bomb",
    inspiredByFamily: "bomb",
    memory: "weapon",
    era: "bn3",
    hits: 3,
    originSite: "fallen-ruin",
    memoryText:
      "The last hearth of a settlement that ended in one night. The flame refused to forget its purpose.",
  },
  {
    id: "ember-that-refused",
    name: "Ember That Refused",
    family: "featured",
    class: "apex",
    element: "ember",
    tactic: "none",
    power: 160,
    mb: 28,
    codes: ["L", "R", "*"],
    description:
      "Last Ember after it reinterpreted survival as defiance. Four flames, and a refusal to go out.",
    summon: "bomb",
    inspiredByFamily: "bomb",
    memory: "weapon",
    era: "bn3",
    hits: 4,
    originSite: "fallen-ruin",
    memoryText:
      "The remembered event developed a new interpretation: not the last flame, the flame that would not end.",
  },
  {
    id: "pyre-key",
    name: "Pyre Key",
    family: "featured",
    class: "standard",
    element: "ember",
    tactic: "none",
    power: 70,
    mb: 14,
    codes: ["P", "Y", "*"],
    description: "A pyric instruction. Heat that still knows the shape of a funeral or a forge.",
    summon: "wick",
    inspiredByFamily: "bomb",
    memory: "weapon",
    era: "bn3",
    originSite: "old-battlefield",
    memoryText: "Coherent fire — grief or craft, the Lattice does not moralize.",
  },
  {
    id: "gale-key",
    name: "Gale Key",
    family: "featured",
    class: "standard",
    element: "tide",
    tactic: "gale",
    power: 55,
    mb: 12,
    codes: ["G", "A", "*"],
    description: "Wind given a job. Opens space, carries another Key's output, or strips a veil.",
    summon: "wave",
    inspiredByFamily: "airshot",
    memory: "weapon",
    era: "bn3",
    originSite: "living-water",
    memoryText: "Air over moving water. A repeating rhythm that learned how to push.",
  },
  {
    id: "firestorm",
    name: "Firestorm",
    family: "featured",
    class: "apex",
    element: "ember",
    tactic: "gale",
    power: 140,
    mb: 32,
    codes: ["F", "S"],
    description: "Pyre Key braided with Gale Key. Heat given weather.",
    summon: "gyre",
    inspiredByFamily: "wind",
    memory: "weapon",
    era: "bn4",
    originSite: "old-battlefield",
    memoryText: "An Echo Sequence: fire that learned the grammar of wind.",
  },
  {
    id: "grief-echo",
    name: "Grief Echo",
    family: "featured",
    class: "standard",
    element: "void",
    tactic: "mark",
    power: 40,
    mb: 16,
    codes: ["G", "R", "*"],
    description: "A memory of loss coherent enough to execute. Disrupts another Anima's frequency.",
    summon: "silence",
    inspiredByFamily: "dark",
    memory: "dark",
    era: "bn4",
    originSite: "quiet-yard",
    memoryText: "Thousands of minds meeting the same absence. The Lattice kept the chord.",
  },
  {
    id: "memory-echo",
    name: "Memory Echo",
    family: "featured",
    class: "standard",
    element: "void",
    tactic: "summon",
    power: 0,
    mb: 20,
    codes: ["M", "E", "*"],
    description: "Replays a fragment of a historical Echo. Temporarily modifies the Anima's configuration.",
    summon: "sigil",
    inspiredByFamily: "plus",
    memory: "plus",
    era: "bn3",
    originSite: "sacred-place",
    memoryText: "A place where people kept telling the same story until the story learned to stand.",
  },
  {
    id: "veil-key",
    name: "Veil Key",
    family: "featured",
    class: "standard",
    element: "grove",
    tactic: "none",
    power: 0,
    mb: 14,
    codes: ["V", "L", "*"],
    description: "A shielding harmonic. Softens incoming frequency; can hide a path.",
    summon: "aura",
    inspiredByFamily: "barrier",
    memory: "field",
    era: "bn3",
    originSite: "sanctuary-garden",
    memoryText: "Intention and leaf-light held in the same tempo long enough to thicken.",
  },
  {
    id: "mourning-gate",
    name: "Mourning Gate",
    family: "featured",
    class: "apex",
    element: "void",
    tactic: "summon",
    power: 0,
    mb: 44,
    codes: ["M", "G"],
    description:
      "Grief Echo + Memory Echo + Veil Key. Opens a traversal pathway through remembered loss — a door, not a wound.",
    summon: "rift",
    inspiredByFamily: "secret",
    memory: "field",
    era: "bn5",
    originSite: "quiet-yard",
    memoryText: "Three memories of absence agreed on a shape. The Lattice called it a gate.",
  },
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ELEMENTS = /** @type {EchoElement[]} */ (["ember", "tide", "volt", "grove"]);
const ELEMENT_ADJ = {
  ember: "Cinder",
  tide: "Brine",
  volt: "Arc",
  grove: "Moss",
};

function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function codesFrom(index, star = true) {
  const a = LETTERS[index % 26];
  const b = LETTERS[(index * 3 + 5) % 26];
  const c = LETTERS[(index * 7 + 11) % 26];
  return star ? [a, b, c, "*"] : [a, b];
}

/**
 * Compact lineages inspired by BN2–6 families that the 138-fragment catalog
 * only sketched. Each tuple: [family, inspiredBy, summon, tactic, era, names[], powers[]]
 * @type {Array<[string, string, string, EchoTactic, EchoEra, string[], number[]]>}
 */
const LINEAGES = [
  ["needleburst", "vulcan", "cannon", "none", "bn2", ["Needle Burst", "Needle Storm", "Needle Barrage", "Needle Super"], [10, 10, 10, 10]],
  ["siegepulse", "tankcannon", "howitzer", "shatter", "bn6", ["Siege Pulse", "Siege Howl", "Siege Crown"], [120, 160, 200]],
  ["aethersail", "airshot", "wave", "gale", "bn2", ["Aether Sail", "Aether Push", "Aether Gale"], [20, 30, 40]],
  ["counterhymn", "anti", "shield", "mark", "bn2", ["Counter Hymn", "Counter Ember", "Counter Tide", "Counter Volt", "Counter Grove", "Counter Wound"], [0, 0, 0, 0, 0, 0]],
  ["wave-lock", "starforce-card", "lockon", "mark", "starforce", ["Lock Vein", "Twin Lock", "Star Lock", "Lock Crown"], [50, 70, 90, 130]],
  ["wave-plasma", "starforce-card", "cannon", "none", "starforce", ["Plasma Thread", "Plasma Fan", "Plasma Nova"], [60, 90, 140]],
  ["wave-brother", "starforce-brother", "sigil", "summon", "starforce", ["Brother Pulse", "Brother Guard", "Brother Sync"], [40, 0, 80]],
  ["force-bang", "starforce-fbb", "rift", "none", "starforce", ["Force Bloom", "Force Divide", "Force Chorus"], [220, 260, 300]],
  ["plus-core", "plus", "buster", "none", "bn3", ["Operator +10", "Operator +20", "Operator +30", "Anima +40"], [10, 20, 30, 40]],
  ["dark-veil", "dark", "rift", "none", "bn4", ["Shade Debt", "Shade Feast", "Shade Crown", "Shade License"], [180, 240, 300, 0]],
  ["chip-gate", "secret", "prism", "none", "bn5", ["Gate Flicker", "Gate Bond", "Beast Link Echo"], [70, 90, 120]],
  ["cross-system", "bn6-cross", "sword", "blade", "bn6", ["Cross Slash", "Cross Heat", "Cross Spout", "Cross Bolt", "Cross Root"], [80, 100, 100, 100, 100]],
  ["beast-out", "bn6-beast", "fist", "shatter", "bn6", ["Beast Claw", "Beast Fang", "Beast Howl"], [90, 120, 160]],
  ["soul-unison", "bn4-soul", "sigil", "summon", "bn4", ["Soul Ember", "Soul Tide", "Soul Volt", "Soul Grove", "Soul Void"], [70, 70, 70, 70, 70]],
  ["double-soul", "bn4-ds", "sigil", "summon", "bn4", ["Twin Soul Pulse", "Twin Soul Guard", "Twin Soul Cut"], [80, 0, 110]],
  ["chaos-unison", "bn5-chaos", "rift", "none", "bn5", ["Chaos Thread", "Chaos Fold", "Chaos Peak"], [90, 130, 180]],
  ["team-link", "bn5-team", "sigil", "summon", "bn5", ["Team Pulse", "Team Guard", "Team Barrage"], [50, 0, 90]],
  ["liberation", "bn5-lib", "field", "none", "bn5", ["Liberate Spark", "Liberate Ward", "Liberate Crown"], [40, 0, 100]],
  ["ncp-style", "ncp", "gauge", "none", "bn6", ["Tempo Weave", "Buster Weave", "Custom +1", "Folder Compress"], [0, 0, 0, 0]],
  ["panel-craft", "panel", "panel", "none", "bn3", ["Crack Veil", "Ice Veil", "Grass Veil", "Holy Veil", "Hole Veil", "Magma Veil"], [0, 0, 0, 0, 0, 40]],
  ["wind-rack", "wind", "gyre", "gale", "bn4", ["Wind Rack", "Wind Shear", "Wind Crown"], [80, 110, 150]],
  ["cursor-line", "cursor", "lockon", "mark", "bn4", ["Cursor Pin", "Cursor Fan", "Cursor Hunt"], [60, 80, 110]],
  ["break-line", "break", "hammer", "shatter", "bn4", ["Break Mallet", "Break Charge", "Break Crown"], [90, 130, 170]],
  ["obstacle-line", "obstacle", "cube", "summon", "bn3", ["Solid Cube", "Ice Cube", "Rock Cube", "Guardian Cube"], [0, 0, 0, 0]],
  ["mend-plus", "recovery", "mend", "mend", "bn1", ["Mend +80", "Mend +120", "Mend +200", "Mend All"], [80, 120, 200, 300]],
  ["invis-plus", "invis", "fade", "none", "bn2", ["Fade Veil", "Fade Strike", "Fade Idle", "Full Fade"], [0, 0, 0, 0]],
  ["aura-plus", "barrier", "aura", "none", "bn3", ["Null Aura 80", "Null Aura 150", "Life Aura", "Bubble Wrap"], [0, 0, 0, 0]],
  ["buster-plus", "buster-mod", "buster", "none", "bn1", ["Buster Guard", "Buster Seed", "Buster Edge", "Buster Fist"], [0, 40, 70, 80]],
  ["navi-echo", "navi", "sigil", "summon", "bn3", ["Mendlight EX", "Shock Titan EX", "Column Slash EX", "Cinder Arm EX", "Storm Pin EX"], [100, 140, 200, 180, 190]],
  ["giga-echo", "giga-bn6", "rift", "none", "bn6", ["Area Bloom EX", "Delta Veil EX", "Hub Chorus EX", "Beast Breath", "Cross Divide Echo"], [240, 300, 0, 280, 260]],
];

const WAVE_NAMES = [
  ["Comet Thread", "blast along the locked row"],
  ["Meteor Knuckle Echo", "fist of falling light on the lock"],
  ["Satellite Pin", "orbiting needle that seeks the lock"],
  ["Wave Buster", "default wave-gun pulse"],
  ["Charge Wave", "held lock releases a heavier pulse"],
  ["Wide Wave", "lock spreads one column"],
  ["Long Wave", "lock reaches two panels deep"],
  ["Noise Crush", "static burst that ignores a barrier"],
  ["Noise Fade", "brief invis while the lock holds"],
  ["Tribe Ember", "fire-tribe card along the lock"],
  ["Tribe Tide", "aqua-tribe card along the lock"],
  ["Tribe Grove", "wood-tribe card along the lock"],
  ["Tribe Volt", "elec-tribe card along the lock"],
  ["Star Pulse", "cheap star-force poke"],
  ["Star Fan", "three-way star spray"],
  ["Star Crown", "heavy star-force finisher"],
  ["Geo Pulse", "ground-wave along the lock"],
  ["Sky Pulse", "overhead drop on the locked panel"],
  ["Brother Shot", "linked operator adds one pulse"],
  ["Brother Guard", "linked operator sheds one hit"],
  ["Brother Sync Cut", "both operators slash the lock"],
  ["Card Shuffle", "redraw the next Custom hand"],
  ["Lock Boost", "next lock-on shot +40"],
  ["Noise Cancel", "clear a status before the lock fires"],
  ["Force Guard", "nullify one hit while locked"],
  ["Force Step", "step one panel toward the lock"],
  ["Wave Rain", "needles fall on every enemy panel"],
  ["Wave Mine", "leave a seeker on the locked panel"],
  ["Wave Coil", "chain-lightning from the lock"],
  ["Wave Gyre", "tornado on the locked column"],
  ["Wave Mend", "heal while the lock holds"],
  ["Wave Steal", "claim the locked panel"],
  ["Wave Silence", "interrupt the enemy Custom"],
  ["Wave Tempo", "fill Custom faster this turn"],
  ["Wave Fade", "invis until the lock fires"],
  ["Wave Cube", "drop an obstacle on the lock"],
  ["Wave Aura", "aura while locked on"],
  ["Wave Hammer", "break the locked panel"],
  ["Wave Arrow", "piercing lock shot"],
  ["Wave Homing", "second seeker after the lock"],
];

const SIGIL_NAMES = [
  ["Glass Duelist", "blade", "sword", 150],
  ["Forge Colossus", "shatter", "fist", 140],
  ["Tide Oracle", "mend", "mend", 70],
  ["Root Warden", "none", "tower", 130],
  ["Volt Jester", "none", "orb", 120],
  ["Ash Prophet", "none", "bomb", 135],
  ["Mirror Thief", "mark", "steal", 90],
  ["Quiet Bell", "none", "silence", 0],
  ["Stone Cantor", "shatter", "quake", 125],
  ["Sky Needle", "mark", "arrow", 110],
  ["Coil Saint", "none", "coil", 115],
  ["Prism Twin", "none", "prism", 140],
  ["Rift Herald", "none", "rift", 160],
  ["Gauge Priest", "none", "gauge", 0],
  ["Fade Dancer", "gale", "fade", 0],
  ["Cube Mason", "summon", "cube", 0],
  ["Rain Shepherd", "none", "rain", 100],
  ["Mine Whisper", "mark", "mine", 80],
  ["Remote Geist", "mark", "remote", 95],
  ["Wick Keeper", "summon", "wick", 0],
];

const DARK_NAMES = [
  ["Umbral Feast", 200, "rift"],
  ["Umbral Loan", 260, "sword"],
  ["Umbral Tax", 160, "drain"],
  ["Umbral Hole", 0, "panel"],
  ["Umbral Soul", 220, "sigil"],
  ["Umbral License", 0, "gauge"],
  ["Umbral Breath", 280, "gaia"],
  ["Umbral Needle", 140, "lockon"],
  ["Umbral Gyre", 170, "gyre"],
  ["Umbral Mend", 120, "mend"],
];

/**
 * @param {object} partial
 * @param {number} index
 * @returns {Omit<EchoKey, "libraryNo">}
 */
function makeRow(partial, index) {
  const name = partial.name;
  return {
    class: "standard",
    element: "void",
    tactic: "none",
    power: 40,
    mb: 12,
    codes: codesFrom(index),
    description: `${name} — a weapon-memory the Anima summons as ghost-steel.`,
    summon: "cannon",
    inspiredByFamily: "cannon",
    memory: "weapon",
    era: "bn3",
    family: "echo",
    ...partial,
    id: partial.id || slug(name),
    name,
  };
}

function fromFragments() {
  return ENERGY_FRAGMENTS.map((f) => ({
    id: f.id,
    name: f.name,
    family: f.family,
    class: f.class,
    element: f.element,
    tactic: f.tactic,
    power: f.power,
    mb: f.mb,
    codes: [...f.codes],
    description: f.description,
    summon: f.summon,
    inspiredByFamily: f.inspiredByFamily,
    memory: /** @type {EchoMemory} */ (
      f.class === "nova" ? "nova" : f.class === "apex" ? "weapon" : "weapon"
    ),
    era: /** @type {EchoEra} */ ("bn1"),
    ...(f.summonNote ? { summonNote: f.summonNote } : {}),
  }));
}

function fromLineages(startIndex) {
  /** @type {Omit<EchoKey, "libraryNo">[]} */
  const rows = [];
  let i = startIndex;
  for (const [family, inspiredBy, summon, tactic, era, names, powers] of LINEAGES) {
    names.forEach((name, t) => {
      const power = powers[t] ?? powers[powers.length - 1] ?? 40;
      const isApex = /EX|Super|Crown|Chorus|License|Breath|Divide/i.test(name) || t >= 3;
      const isNova = /Force Bloom|Force Divide|Force Chorus|Beast Breath|Hub Chorus EX/i.test(name);
      const memory = family.startsWith("wave")
        ? family === "wave-brother"
          ? "brother"
          : family === "force-bang"
            ? "nova"
            : "wave"
        : family.startsWith("dark")
          ? "dark"
          : family.startsWith("plus")
            ? "plus"
            : family.startsWith("panel") || family === "ncp-style"
              ? "field"
              : isNova
                ? "nova"
                : "weapon";
      rows.push(
        makeRow(
          {
            name,
            family,
            inspiredByFamily: inspiredBy,
            summon,
            tactic,
            era,
            memory: /** @type {EchoMemory} */ (memory),
            class: isNova ? "nova" : isApex ? "apex" : "standard",
            power: power || null,
            mb: Math.min(99, 8 + t * 14 + (isNova ? 40 : 0)),
            hits: family === "needleburst" ? [3, 5, 9, 12][t] : undefined,
            description:
              memory === "plus"
                ? `${name} — Plus-memory. The next loaded Echo Key gains this power.`
                : memory === "dark"
                  ? `${name} — Dark memory. Huge power; the Anima carries a brief HP bug after.`
                  : memory === "wave"
                    ? `${name} — Wave-card memory. Lock a panel, then fire.`
                    : memory === "brother"
                      ? `${name} — Brother-band memory. A linked presence adds one action.`
                      : memory === "nova"
                        ? `${name} — Nova / Force Big Bang memory. One per Folder.`
                        : memory === "field"
                          ? `${name} — Field memory. Rewrites panels, tempo, or the Custom window.`
                          : `${name} — Weapon-memory summoned as ethereal ${summon}.`,
          },
          i++,
        ),
      );
    });
  }
  return rows;
}

function chromaOfCore(coreRows, startIndex) {
  /** @type {Omit<EchoKey, "libraryNo">[]} */
  const rows = [];
  let i = startIndex;
  const cores = coreRows.filter(
    (r) =>
      r.class === "standard" &&
      r.memory === "weapon" &&
      r.element === "void" &&
      (r.power || 0) > 0,
  );
  const pick = cores.slice(0, 52);
  for (const base of pick) {
    for (const el of ELEMENTS) {
      const adj = ELEMENT_ADJ[el];
      rows.push(
        makeRow(
          {
            id: `${base.id}-${el}`,
            name: `${adj} ${base.name}`,
            family: `${base.family}-chroma`,
            class: "standard",
            element: el,
            tactic: base.tactic,
            power: Math.round((base.power || 40) * 1.05),
            mb: Math.min(99, (base.mb || 12) + 4),
            codes: codesFrom(i, true),
            description: `${adj} ${base.name} — the same weapon-memory retuned to ${el}.`,
            summon: base.summon,
            inspiredByFamily: base.inspiredByFamily,
            memory: "weapon",
            era: "bn3",
          },
          i++,
        ),
      );
    }
  }
  return rows;
}

function waveCards(startIndex) {
  let i = startIndex;
  return WAVE_NAMES.map(([name, blurb], t) =>
    makeRow(
      {
        name,
        family: "star-wave",
        inspiredByFamily: "starforce-card",
        summon: t % 5 === 0 ? "lockon" : t % 5 === 1 ? "cannon" : t % 5 === 2 ? "wave" : t % 5 === 3 ? "prism" : "homing",
        tactic: t % 4 === 0 ? "mark" : t % 4 === 1 ? "gale" : "none",
        era: "starforce",
        memory: name.startsWith("Brother") ? "brother" : name.startsWith("Force") ? "nova" : "wave",
        class: name.includes("Crown") || name.includes("Chorus") ? "apex" : "standard",
        element: ELEMENTS[t % ELEMENTS.length],
        power: 40 + (t % 8) * 15,
        mb: 8 + (t % 6) * 6,
        description: `${name} — Star Force card-memory. ${blurb}.`,
      },
      i++,
    ),
  );
}

function sigilTiers(startIndex) {
  /** @type {Omit<EchoKey, "libraryNo">[]} */
  const rows = [];
  let i = startIndex;
  for (const [name, tactic, summon, power] of SIGIL_NAMES) {
    for (const [tier, klass, mul, era] of [
      ["", "standard", 1, "bn3"],
      [" V2", "apex", 1.25, "bn4"],
      [" V3", "apex", 1.5, "bn5"],
      [" SP", "apex", 1.75, "bn6"],
    ]) {
      rows.push(
        makeRow(
          {
            name: `${name}${tier}`.trim(),
            family: "echo-sigil",
            inspiredByFamily: "navi",
            summon,
            tactic: /** @type {EchoTactic} */ (tactic),
            era: /** @type {EchoEra} */ (era),
            memory: "weapon",
            class: /** @type {EchoClass} */ (klass),
            power: Math.round(Number(power) * Number(mul)) || null,
            mb: klass === "apex" ? 48 : 28,
            codes: klass === "standard" ? codesFrom(i) : [LETTERS[i % 26]],
            description: `${name}${tier} — Navi-sigil memory. An outline of another presence fires, then fades.`,
          },
          i++,
        ),
      );
    }
  }
  return rows;
}

function darkKeys(startIndex) {
  let i = startIndex;
  return DARK_NAMES.flatMap(([name, power, summon], t) =>
    ["", " EX"].map((tier, u) =>
      makeRow(
        {
          name: `${name}${tier}`.trim(),
          family: "umbral",
          inspiredByFamily: "dark",
          summon,
          tactic: summon === "mend" ? "mend" : "none",
          era: u ? "bn5" : "bn4",
          memory: "dark",
          class: u ? "nova" : "apex",
          power: power ? power + u * 40 : null,
          mb: 70 + u * 12,
          codes: [LETTERS[(t + u * 9) % 26]],
          description: `${name}${tier} — Dark / emotion-window memory. Huge power, brief corruption.`,
        },
        i++,
      ),
    ),
  );
}

function plusAndField(startIndex) {
  let i = startIndex;
  const plus = [10, 20, 30, 40, 50].flatMap((n, t) =>
    ["Buster", "Folder", "Anima", "Custom"].map((who) =>
      makeRow(
        {
          name: `${who} +${n}`,
          family: "plus-memory",
          inspiredByFamily: "plus",
          summon: "buster",
          tactic: "none",
          era: "bn3",
          memory: "plus",
          class: n >= 40 ? "apex" : "standard",
          power: n,
          mb: 6 + t * 4,
          description: `${who} +${n} — Plus-memory. Raises ${who.toLowerCase()} output for this Custom.`,
        },
        i++,
      ),
    ),
  );
  const fields = [
    "Cracked Row",
    "Ice Column",
    "Grass Field",
    "Holy Center",
    "Magma Edge",
    "Hole Trap",
    "Poison Fog",
    "Holy Repair",
  ].map((name) =>
    makeRow(
      {
        name,
        family: "field-memory",
        inspiredByFamily: "panel",
        summon: "panel",
        tactic: "none",
        era: "bn6",
        memory: "field",
        class: "standard",
        power: null,
        mb: 16,
        description: `${name} — Field memory that rewrites panels the way later Battle Network chips did.`,
      },
      i++,
    ),
  );
  return [...plus, ...fields];
}

function padToTarget(rows) {
  let i = rows.length;
  const extras = [];
  const verbs = ["Echo", "Afterimage", "Remnant", "Imprint", "Trace", "Resonance"];
  const nouns = [
    "Lance", "Fan", "Coil", "Orb", "Sheet", "Spike", "Bloom", "Pin", "Veil", "Rift",
    "Gyre", "Mallet", "Arrow", "Sail", "Wick", "Cube", "Rain", "Mine", "Seek", "Lock",
  ];
  while (rows.length + extras.length < ECHO_KEY_LIBRARY_SIZE) {
    const n = rows.length + extras.length;
    const name = `${verbs[n % verbs.length]} ${nouns[n % nouns.length]} ${Math.floor(n / 20) + 1}`;
    extras.push(
      makeRow(
        {
          name,
          family: "imprint",
          inspiredByFamily: "cannon",
          summon: nouns[n % nouns.length] === "Veil" ? "aura" : "cannon",
          tactic: n % 5 === 0 ? "blade" : n % 5 === 1 ? "gale" : n % 5 === 2 ? "mark" : "none",
          era: /** @type {EchoEra} */ (["bn2", "bn3", "bn4", "bn5", "bn6"][n % 5]),
          memory: "weapon",
          element: ELEMENTS[n % ELEMENTS.length],
          power: 35 + (n % 12) * 8,
          mb: 10 + (n % 8) * 4,
          description: `${name} — extra weapon-memory so the operator's library can hold a full 800-key profile.`,
        },
        i++,
      ),
    );
  }
  return extras;
}

function numberLibrary(rows) {
  return rows.map((row, i) => ({ ...row, libraryNo: i + 1 }));
}

function assemble() {
  const seen = new Set();
  /** @type {Omit<EchoKey, "libraryNo">[]} */
  const out = [];
  const add = (list) => {
    for (const row of list) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
      if (out.length >= ECHO_KEY_LIBRARY_SIZE) return;
    }
  };

  const fragments = fromFragments();
  add(fragments);
  add(FEATURED_RESONANCE_KEYS.map((row, i) => makeRow(row, 8000 + i)));
  add(fromLineages(out.length));
  add(chromaOfCore(fragments, out.length));
  add(waveCards(out.length));
  add(sigilTiers(out.length));
  add(darkKeys(out.length));
  add(plusAndField(out.length));
  if (out.length < ECHO_KEY_LIBRARY_SIZE) add(padToTarget(out));
  return numberLibrary(out.slice(0, ECHO_KEY_LIBRARY_SIZE));
}

/** @type {EchoKey[]} */
export const ECHO_KEYS = assemble();

/** @type {Record<string, EchoKey>} */
export const ECHO_KEY_BY_ID = Object.fromEntries(ECHO_KEYS.map((k) => [k.id, k]));

/** @param {string} id */
export function getEchoKey(id) {
  return ECHO_KEY_BY_ID[id] || null;
}

/** @param {string} family */
export function echoKeysByFamily(family) {
  return ECHO_KEYS.filter((k) => k.family === family);
}

/** @param {EchoClass} klass */
export function echoKeysByClass(klass) {
  return ECHO_KEYS.filter((k) => k.class === klass);
}

/** @param {EchoMemory} memory */
export function echoKeysByMemory(memory) {
  return ECHO_KEYS.filter((k) => k.memory === memory);
}

export function allEchoKeyIds() {
  return ECHO_KEYS.map((k) => k.id);
}
