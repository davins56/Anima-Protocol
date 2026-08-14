// @ts-check
/**
 * Research account of the Mega Man Battle Network Battle Chip system.
 *
 * This is a design reference — chip family names and public mechanics from the
 * games — used to invent original Energy Fragments. Playable battle data lives
 * in `catalog.js` and does not reuse Capcom chip names, Navi names, or art.
 *
 * Sources: MMBN 1 library (176 Standard/Navi chips), later class split in BN3
 * (Standard / Mega / Giga), element cycle, BN4–5 Types, BN6 Cross types,
 * Program Advances, Dark/Evil chips.
 */

/** @typedef {"standard" | "mega" | "giga" | "dark" | "secret" | "navi"} ChipClass */

/**
 * @typedef {object} ChipFamilyAccount
 * @property {string} id
 * @property {string} label
 * @property {string[]} games
 * @property {string[]} members
 * @property {string} mechanic
 * @property {string} [elementNote]
 */

export const BATTLE_CHIP_SYSTEM = {
  title: "Battle Chip system (Mega Man Battle Network)",
  summary:
    "Operators load Battle Chips into a Folder on a PET. In battle, a Custom Screen draws a random hand; chips that share a name or a letter code can be slotted together. Selected chips download into the NetNavi as one-shot programs — cannons, swords, bombs, recovery, terrain, and Navi summons. Combinations of specific chips trigger a Program Advance.",
  battlefield:
    "An 18-panel grid (3×6). The operator's Navi holds 9 panels; viruses hold the other 9. Movement, range, and panel states (cracked, hole, ice, grass, holy) all matter.",
  buster:
    "The Mega Buster is the default arm cannon when no chip is queued. Charge shots and chip-modded B buttons (BstrGard / BstrBomb / BstrSwrd / BstrPnch) fill the gaps between Custom draws.",
};

export const CHIP_CLASSES = [
  {
    id: "standard",
    label: "Standard",
    folderCap: "Up to 4 copies of the same chip; 30 chips in a Folder (BN3+).",
    note: "Workhorse attacks, recovery, terrain, and early-game Navi chips.",
  },
  {
    id: "mega",
    label: "Mega",
    folderCap: "5 Mega chips per Folder, 1 copy of each (BN3+). Later, Mega = Navi chips.",
    note: "Introduced in Battle Network 3. Powerful Navi-style programs.",
  },
  {
    id: "giga",
    label: "Giga",
    folderCap: "1 Giga chip per Folder. Often version-exclusive.",
    note: "Super-rare finishers (Bass, DeltaRay, HubBatch, Cybeast breath, etc.).",
  },
  {
    id: "navi",
    label: "Navi Chip",
    folderCap: "Treated as Standard in BN1–2; Mega (or Giga) from BN3 on.",
    note: "Summons another NetNavi's signature attack. V2/V3 (later EX/SP) are upgrades.",
  },
  {
    id: "dark",
    label: "Dark / Evil",
    folderCap: "Restricted by emotion window, Dark Hole panels, or DarkLicense.",
    note: "Huge power, corrupts the Navi (HP Bug, Dark Soul). BN3 Evil chips; BN4 Dark chips.",
  },
  {
    id: "secret",
    label: "Secret / Gate",
    folderCap: "Varies. Gate chips come from Battle Chip Gate / Progress / Beast Link toys.",
    note: "Trade, event, or peripheral chips. Often omitted from 100% library counts.",
  },
];

export const CHIP_ELEMENTS = [
  { id: "none", label: "Null", cycle: "No elemental bonus." },
  { id: "fire", label: "Fire", cycle: "2× vs Wood. Strong on magma panels." },
  { id: "aqua", label: "Aqua", cycle: "2× vs Fire. Strong on ice panels." },
  { id: "wood", label: "Wood", cycle: "2× vs Aqua. Strong on grass panels." },
  { id: "elec", label: "Elec", cycle: "2× vs Aqua in some titles; no full cycle in BN1." },
];

export const CHIP_TYPES_LATER = [
  { id: "sword", label: "Sword", note: "BN4–6 type. Close-range slashes; BN6: weak to Break." },
  { id: "wind", label: "Wind", note: "Pushes / tornadoes. BN6: weak to Sword." },
  { id: "cursor", label: "Cursor", note: "Lock-on / homing. BN6: weak to Wind." },
  { id: "break", label: "Break", note: "Guard-pierce, panel-break. BN6: weak to Cursor." },
  { id: "obstacle", label: "Obstacle", note: "Cubes, statues, mines. Not in the BN6 damage cycle." },
  { id: "plus", label: "Plus", note: "Stat-up chips (Navi+20). Icon only in later games." },
  { id: "summon", label: "Summon", note: "Places a helper object (Anubis, candles, satellites)." },
];

export const FOLDER_AND_CUSTOM = {
  folderSize: 30,
  codes:
    "Each chip copy has a letter code A–Z, plus * (asterisk, BN2+) which matches any code. You may select chips that share a name OR share a code.",
  customGauge:
    "After a hand is used, a Custom Gauge fills. Opening Custom draws more chips (typically 5, plus extra from Add/Regular chips).",
  regularChip: "BN3+ can pin one chip as Regular so it always appears in the opening hand.",
  programAdvance:
    "Specific sequences (e.g. Cannon + HiCannon + M-Cannon, or Sword + WideSword + LongSword) fuse into a named Program Advance with unique animation and power.",
};

/**
 * BN1 Standard library, grouped by family. Member names are the in-game chip
 * names as a research ledger — not playable assets.
 *
 * @type {ChipFamilyAccount[]}
 */
export const BN1_CHIP_FAMILIES = [
  {
    id: "cannon",
    label: "Cannon",
    games: ["BN1"],
    members: ["Cannon", "HiCannon", "M-Cannon"],
    mechanic: "Straight-shot arm cannon. The iconic 'a nice, big cannon!' line. PA: Giga Cannon.",
  },
  {
    id: "spreader",
    label: "Shotgun / Spreader",
    games: ["BN1"],
    members: ["Shotgun", "CrossGun", "Spreader", "Bubbler", "Heater"],
    mechanic: "Gun that continues through the hit panel (plus blast). Bubbler/Heater are elemental spreaders.",
    elementNote: "Bubbler Aqua, Heater Fire.",
  },
  {
    id: "bomb",
    label: "Bomb",
    games: ["BN1"],
    members: ["MiniBomb", "LilBomb", "CrosBomb", "BigBomb"],
    mechanic: "Thrown 3 panels deep. Cross/Big variants change blast shape.",
  },
  {
    id: "sword",
    label: "Sword",
    games: ["BN1"],
    members: [
      "Sword",
      "WideSwrd",
      "LongSwrd",
      "FtrSwrd",
      "KngtSwrd",
      "HeroSwrd",
      "FireSwrd",
      "AquaSwrd",
      "ElecSwrd",
    ],
    mechanic: "Melee slash. Wide = column, Long = 2 panels, Fighter/Knight/Hero = 3-panel legendary blades. Elemental swords cut a column.",
    elementNote: "Fire / Aqua / Elec variants.",
  },
  {
    id: "muramasa",
    label: "Muramasa",
    games: ["BN1"],
    members: ["Muramasa"],
    mechanic: "Damage equals HP already lost. High-risk finisher.",
  },
  {
    id: "shockwave",
    label: "Shock Wave",
    games: ["BN1"],
    members: ["ShokWave", "SoniWave", "DynaWave"],
    mechanic: "Piercing ground wave that travels a row.",
  },
  {
    id: "tower",
    label: "Tower",
    games: ["BN1"],
    members: ["FireTowr", "AquaTowr", "WoodTowr"],
    mechanic: "Vertical pillar that can be steered up/down a column.",
    elementNote: "Fire / Aqua / Wood.",
  },
  {
    id: "quake",
    label: "Quake",
    games: ["BN1"],
    members: ["Quake1", "Quake2", "Quake3"],
    mechanic: "Thrown stone that cracks the landing panel (depth 3).",
  },
  {
    id: "punch",
    label: "Punch",
    games: ["BN1"],
    members: ["GutsPnch", "IcePunch"],
    mechanic: "Point-blank knockback. Breaks obstacles.",
  },
  {
    id: "dash",
    label: "Dash",
    games: ["BN1"],
    members: ["Dash"],
    mechanic: "Rush the row; knock over everything in the path.",
  },
  {
    id: "howitzer",
    label: "Howitzer",
    games: ["BN1"],
    members: ["Howitzer"],
    mechanic: "Heavy shell that breaks panels (depth 3).",
  },
  {
    id: "arrow",
    label: "Tri-Arrow",
    games: ["BN1"],
    members: ["TriArrow", "TriSpear", "TriLance"],
    mechanic: "Three-shot burst of piercing projectiles.",
  },
  {
    id: "ratton",
    label: "Ratton",
    games: ["BN1"],
    members: ["Ratton1", "Ratton2", "Ratton3"],
    mechanic: "Missile that can turn once toward a target.",
  },
  {
    id: "row-wave",
    label: "Row Wave",
    games: ["BN1"],
    members: ["Wave", "RedWave", "BigWave"],
    mechanic: "3-row sweeping wave. Aqua / Fire / giant Aqua.",
    elementNote: "Aqua, Fire, Aqua.",
  },
  {
    id: "gaia",
    label: "Gaia",
    games: ["BN1"],
    members: ["Gaia1", "Gaia2", "Gaia3"],
    mechanic: "Rolling 3-column explosion across the field.",
  },
  {
    id: "thunder",
    label: "Thunder",
    games: ["BN1"],
    members: ["Thunder1", "Thunder2", "Thunder3"],
    mechanic: "Slow-rolling lightning orb.",
    elementNote: "Elec.",
  },
  {
    id: "ringzap",
    label: "Ring Zap",
    games: ["BN1"],
    members: ["RingZap1", "RingZap2", "RingZap3"],
    mechanic: "Lightning circles the Navi 1/2/3 times.",
    elementNote: "Elec.",
  },
  {
    id: "tornado",
    label: "Tornado",
    games: ["BN1"],
    members: ["Typhoon", "Huricane", "Cyclone"],
    mechanic: "Stationary twister that multi-hits (3 / 5 / 8).",
  },
  {
    id: "snake",
    label: "Snake Egg",
    games: ["BN1"],
    members: ["Snakegg1", "Snakegg2", "Snakegg3"],
    mechanic: "Squirming snake that crawls toward viruses.",
  },
  {
    id: "drain",
    label: "Drain",
    games: ["BN1"],
    members: ["Drain1", "Drain2", "Drain3"],
    mechanic: "Charge in place to steal HP from the enemy.",
  },
  {
    id: "bodyburn",
    label: "Body Burn",
    games: ["BN1"],
    members: ["BodyBurn"],
    mechanic: "Engulf adjacent panels in flame.",
    elementNote: "Fire.",
  },
  {
    id: "xpanel",
    label: "X-Panel",
    games: ["BN1"],
    members: ["X-Panel1", "X-Panel3"],
    mechanic: "Deletes 1 panel or a whole column (holes).",
  },
  {
    id: "hammer",
    label: "Hammer",
    games: ["BN1"],
    members: ["Hammer"],
    mechanic: "Breaks cubes / obstacles at range 1.",
  },
  {
    id: "guard",
    label: "Guard",
    games: ["BN1"],
    members: ["MetGuard", "IronShld"],
    mechanic: "Hold-button shield. MetGuard is the Mettaur helmet parry.",
  },
  {
    id: "recovery",
    label: "Recovery",
    games: ["BN1"],
    members: ["Recov10", "Recov30", "Recov50", "Recov80", "Recov120", "Recov150", "Recov200", "Recov300"],
    mechanic: "Instant HP restore. AntiRecv exists in later games as a trap.",
  },
  {
    id: "steal",
    label: "Area Steal",
    games: ["BN1"],
    members: ["Steal"],
    mechanic: "Claims the left column of the enemy area.",
  },
  {
    id: "geddon",
    label: "Geddon",
    games: ["BN1"],
    members: ["Geddon1", "Geddon2"],
    mechanic: "Cracks every panel, or erases empty panels into holes.",
  },
  {
    id: "escape",
    label: "Escape",
    games: ["BN1"],
    members: ["Escape"],
    mechanic: "Jack out of most (not boss) fights.",
  },
  {
    id: "interrupt",
    label: "Interrupt",
    games: ["BN1"],
    members: ["Interupt"],
    mechanic: "Destroys the enemy's queued chip data.",
  },
  {
    id: "repair",
    label: "Repair",
    games: ["BN1"],
    members: ["Repair"],
    mechanic: "Restores panels on your side.",
  },
  {
    id: "timebomb",
    label: "Time Bomb",
    games: ["BN1"],
    members: ["TimeBom1", "TimeBom2", "TimeBom3"],
    mechanic: "Places a countdown bomb in the enemy area.",
  },
  {
    id: "cloud",
    label: "Cloud",
    games: ["BN1"],
    members: ["Cloud", "Cloudier", "Cloudest"],
    mechanic: "Rain that sweeps up and down one column.",
    elementNote: "Aqua.",
  },
  {
    id: "mine",
    label: "Mine",
    games: ["BN1"],
    members: ["Mine1", "Mine2", "Mine3"],
    mechanic: "Hidden mine on an enemy panel.",
  },
  {
    id: "dynamite",
    label: "Dynamite",
    games: ["BN1"],
    members: ["Dynamyt1", "Dynamyt2", "Dynamyt3"],
    mechanic: "Seeks right / diagonally / vertically for a target, then detonates.",
  },
  {
    id: "remobit",
    label: "Remobit",
    games: ["BN1"],
    members: ["Remobit1", "Remobit2", "Remobit3"],
    mechanic: "Remote-controlled smasher the operator steers.",
  },
  {
    id: "lockon",
    label: "Lock-On",
    games: ["BN1"],
    members: ["Lockon1", "Lockon2", "Lockon3"],
    mechanic: "Orbiting satellite that auto-fires.",
  },
  {
    id: "candle",
    label: "Candle",
    games: ["BN1"],
    members: ["Candle1", "Candle2", "Candle3"],
    mechanic: "Summon that ticks HP recovery until snuffed.",
  },
  {
    id: "anubis",
    label: "Anubis",
    games: ["BN1"],
    members: ["Anubis"],
    mechanic: "Statue that steadily drains enemy HP.",
  },
  {
    id: "cube",
    label: "Cube",
    games: ["BN1"],
    members: ["IceCube", "RockCube"],
    mechanic: "Obstacle summons. Ice melts; rock is a Break target.",
  },
  {
    id: "buster-mod",
    label: "Buster Mod",
    games: ["BN1"],
    members: ["BstrGard", "BstrBomb", "BstrSwrd", "BstrPnch"],
    mechanic: "One Custom turn of MetGuard / MiniBomb / Sword / Guts Punch on the B button.",
  },
  {
    id: "gauge",
    label: "Custom Gauge",
    games: ["BN1"],
    members: ["SloGauge", "FstGauge"],
    mechanic: "Slows or speeds the Custom Gauge for both sides.",
  },
  {
    id: "invis",
    label: "Invisibility",
    games: ["BN1"],
    members: ["Invis1", "Invis2", "Invis3", "Dropdown", "Popup"],
    mechanic: "Temporary invuln, or invis-until-attack / invis-when-idle.",
  },
  {
    id: "ironbody",
    label: "Iron Body",
    games: ["BN1"],
    members: ["IronBody"],
    mechanic: "Stone-shape: defense up, cannot move for a duration.",
  },
  {
    id: "barrier",
    label: "Barrier / Wrap / Aura",
    games: ["BN1"],
    members: [
      "Barrier",
      "BblWrap1",
      "BblWrap2",
      "BblWrap3",
      "LeafShld",
      "AquaAura",
      "FireAura",
      "WoodAura",
      "LifeAura",
    ],
    mechanic:
      "Barrier nullifies 1 hit. Bubble Wrap regenerates (Aqua). Leaf converts 1 hit to HP. Auras negate hits below a damage threshold and have elemental weaknesses.",
  },
  {
    id: "navi",
    label: "Navi Chips",
    games: ["BN1"],
    members: [
      "Roll / 2 / 3",
      "GutsMan / 2 / 3",
      "ProtoMan / 2 / 3",
      "FireMan / 2 / 3",
      "NumbrMan / 2 / 3",
      "StoneMan / 2 / 3",
      "IceMan / 2 / 3",
      "ColorMan / 2 / 3",
      "ElecMan / 2 / 3",
      "BombMan / 2 / 3",
      "MagicMan / 2 / 3",
      "WoodMan / 2 / 3",
      "SkullMan / 2 / 3",
      "SharkMan / 2 / 3",
      "PharoMan / 2 / 3",
      "ShadoMan / 2 / 3",
      "Bass",
    ],
    mechanic:
      "Each Navi chip plays that Navi's signature (heal-shot, column slash, fire arm, dice, stones, blizzard, dual towers, lightning, cross-bomb, magic fire, wood spike, skull, shark fin, coffin laser, star split, area explode). V2/V3 raise power.",
  },
];

/** Families and classes added after BN1. */
export const LATER_CHIP_FAMILIES = [
  {
    id: "vulcan",
    label: "Vulcan",
    games: ["BN2+"],
    members: ["Vulcan1", "Vulcan2", "Vulcan3", "SuperVulcan"],
    mechanic: "Multi-hit machine gun. Super Vulcan is a high-MB Standard in BN6.",
  },
  {
    id: "airshot",
    label: "Air Shot",
    games: ["BN2+"],
    members: ["AirShot"],
    mechanic: "Wind-type poke that pushes targets and is cheap MB.",
  },
  {
    id: "tankcannon",
    label: "Tank Cannon",
    games: ["BN6"],
    members: ["TankCannon1", "TankCannon2", "TankCannon3"],
    mechanic: "Heavy cannon with splash.",
  },
  {
    id: "anti",
    label: "Anti Chips",
    games: ["BN2+"],
    members: ["AntiNavi", "AntiFire", "AntiWater", "AntiElec", "AntiWood", "AntiDmg", "AntiRecv"],
    mechanic: "Traps that counter a specific element, Navi summon, damage, or heal.",
  },
  {
    id: "giga-bn6",
    label: "BN6 Giga (version exclusive)",
    games: ["BN6"],
    members: [
      "Gregar: Bass, BigHook, DeltaRay, ColonelForce, BugRiseSword",
      "Falzar: BassAnly, MeteorKnuckle, CrossDivide, HubBatch, BugDeathThunder",
    ],
    mechanic: "One Giga per Folder. Cybeast e-Reader chips (Gregar / Falzar breath) exist as extras.",
  },
];

export const PROGRAM_ADVANCE_EXAMPLES = [
  { chips: ["Cannon", "HiCannon", "M-Cannon"], result: "Giga Cannon (300–500 depending on game)" },
  { chips: ["Sword", "WideSword", "LongSword"], result: "Life Sword / Wide Burner line" },
  { chips: ["MiniBomb", "LilBomb", "CrosBomb"], result: "Hyper Burst / bomb PAs" },
];

/**
 * Map each researched family onto the Energy Fragment family id used in catalog.js.
 * @type {Record<string, string>}
 */
export const FAMILY_TO_FRAGMENT = {
  cannon: "pulse",
  spreader: "halo",
  bomb: "seed",
  sword: "phantom",
  muramasa: "echo-debt",
  shockwave: "tremor",
  tower: "spire",
  quake: "fault",
  punch: "geist",
  dash: "afterimage",
  howitzer: "breaker",
  arrow: "gleam",
  ratton: "wisp",
  "row-wave": "sheet",
  gaia: "rolling-fault",
  thunder: "drift-spark",
  ringzap: "orbit-arc",
  tornado: "gyre",
  snake: "coil",
  drain: "siphon",
  bodyburn: "ignition",
  xpanel: "unmake",
  hammer: "mallet",
  guard: "metveil",
  recovery: "mend",
  steal: "claim",
  geddon: "fracture",
  escape: "jackout",
  interrupt: "silence",
  repair: "restore",
  timebomb: "chrono",
  cloud: "rainveil",
  mine: "hiddenspark",
  dynamite: "seekcharge",
  remobit: "remotegeist",
  lockon: "tracesat",
  candle: "lifewick",
  anubis: "wither",
  cube: "solid",
  "buster-mod": "busterweave",
  gauge: "tempo",
  invis: "fade",
  ironbody: "stoneshape",
  barrier: "nullveil",
  navi: "apex-sigil",
  vulcan: "needleburst",
  airshot: "aethersail",
  tankcannon: "siegepulse",
  anti: "counterhymn",
  "giga-bn6": "nova",
};

export function listedFamilyIds() {
  return [...BN1_CHIP_FAMILIES, ...LATER_CHIP_FAMILIES].map((f) => f.id);
}
