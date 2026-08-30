// @ts-check
/**
 * Research account of Battle Chip (MMBN 1–6, all versions) and Battle Card
 * (Mega Man Star Force 1–3) systems.
 *
 * Design reference only. Playable Echo Keys in `catalog.js` use original Anima
 * names, classes, and weapon-memory flavor — never Capcom chip/Navi/card titles.
 *
 * Sources: BN1 library; BN2–3 class split and Regular chip; BN4 Dark chips /
 * Double Soul / version exclusives; BN5 Team / Liberation / Chaos Unison;
 * BN6 Cross / Beast / Cybeast / Tag / Gregar–Falzar Giga; Star Force Battle
 * Cards, Mega/Giga/Star cards, Brother Band, Best Combo, Noise Change, Tribe On.
 */

/** @typedef {"BN1"|"BN2"|"BN3"|"BN4"|"BN5"|"BN6"|"SF1"|"SF2"|"SF3"} EchoSourceGame */

/**
 * @typedef {object} EchoFamilyAccount
 * @property {string} id
 * @property {string} label
 * @property {EchoSourceGame[]} games
 * @property {string} mechanic
 * @property {string} [elementNote]
 */

export const BATTLE_CHIP_LINEAGE = {
  title: "Battle Chip lineage (Mega Man Battle Network 1–6)",
  summary:
    "Operators load Battle Chips into a 30-chip Folder on a PET. Custom draws a hand; chips that share a name or letter code slot together. Selected chips download as one-shot programs. BN3+ adds Regular chip, Standard/Mega/Giga caps, and Program Advances. BN4 adds Dark chips and Double Soul. BN5 adds Team chips and Chaos Unison. BN6 adds Cross types, Beast Out, Tag chips, and version-exclusive Giga chips (Gregar / Falzar).",
  versions:
    "BN1 (original / tournament extras), BN2, BN3 White/Blue, BN4 Red Sun/Blue Moon, BN5 Team ProtoMan/Colonel (+ Double Team DS), BN6 Cybeast Gregar/Falzar. Version-exclusives and e-Reader / Gate / Progress chips sit beside the core library.",
};

export const STAR_FORCE_CARD_LINEAGE = {
  title: "Battle Card system (Mega Man Star Force 1–3)",
  summary:
    "Operators slot Battle Cards into a Folder. In battle a Custom window draws cards; same-name or same-color cards link. Three matching cards can fire a Best Combo. Mega Cards summon an EM being's signature. Giga Cards are finishers. Star Cards are version-exclusive (Pegasus/Leo/Dragon; Ace/Harrier/Taurus; Crimson Dragon / Cancer / Libra lines). Brother Band lets friends share a card. SF2 Noise Change and SF3 Tribe On remix the card set mid-fight. The field is a 3×5 lock-on grid rather than BN's 3×6 panels.",
  satellites: "Fire, Aqua, Elec, Wood, and Plus. Element cycle mirrors BN with satellite-colored cards.",
  extras:
    "Unique card families include plasma guns, heat uppers, ice needles, poison fruit, jet strikes, wide waves, magnums, Invisible, Barrier, Area Grab, and Star Force / Meteor G finishers.",
};

export const ECHO_KEY_SYSTEM = {
  title: "Echo Keys (Anima Protocol)",
  summary:
    "Echo Keys are crystallized memories of function — weapon-memory an Anima can synchronize with and execute. The Codex names ~800 family memories plus the novels' named Echo Shards, Echo Keys, Sovereign Keys, and Prime Keys. Operators hold the full Codex; Story mode walks the Lattice for flavor and does not hide ownership. A 30-slot Resonance Array is what jacks in. Custom still links by name or letter code, including *. Named novel recipes fire Resonance Combos; Echo of Glass Keys do not fuse into one object. Three Star-class keys, or three of one family, can fire a Best Link. One Regular key always opens the first hand. One Star-Force key can be pinned as an always-available lock-on card.",
};

/** BN2–6 families not already listed in energyFragments/battleChipAccount.js */
export const BN_LATER_FAMILY_ACCOUNT = /** @type {EchoFamilyAccount[]} */ ([
  {
    id: "vulcan",
    label: "Vulcan / machine gun",
    games: ["BN2", "BN3", "BN4", "BN5", "BN6"],
    mechanic: "Multi-hit straight burst. Super Vulcan is a high-MB Standard in BN6.",
  },
  {
    id: "airshot",
    label: "Air Shot",
    games: ["BN2", "BN3", "BN4", "BN5", "BN6"],
    mechanic: "Cheap wind poke that pushes the target one panel.",
  },
  {
    id: "yoyo",
    label: "Yo-Yo / Boomerang",
    games: ["BN2", "BN3", "BN4"],
    mechanic: "Returning projectile that hits going and coming. Wood boomerangs ride grass.",
    elementNote: "Wood variants.",
  },
  {
    id: "wind",
    label: "Wind / Fan",
    games: ["BN2", "BN3", "BN4", "BN5", "BN6"],
    mechanic: "Pushes units or summons a fan that blows a row. BN6 Wind type.",
  },
  {
    id: "tankcannon",
    label: "Tank Cannon",
    games: ["BN6"],
    mechanic: "Heavy cannon with splash on the hit panel.",
  },
  {
    id: "anti",
    label: "Anti chips",
    games: ["BN2", "BN3", "BN4", "BN5", "BN6"],
    mechanic: "Traps that counter an element, a Navi summon, incoming damage, or a heal.",
  },
  {
    id: "varsword",
    label: "VarSword / StepSword",
    games: ["BN3", "BN4", "BN5", "BN6"],
    mechanic: "Input-shaped sword (letter cuts) or a stepping multi-slash down the row.",
  },
  {
    id: "element-guns",
    label: "Lava / Needle / Powder / Reel / Heat",
    games: ["BN2", "BN3", "BN4", "BN5", "BN6"],
    mechanic: "Elemental line attacks: magma cannon, aqua needles, wood powder, elec reel, heat shot.",
    elementNote: "Fire / Aqua / Wood / Elec.",
  },
  {
    id: "panelgrab",
    label: "Panel Grab / Area Grab",
    games: ["BN2", "BN3", "BN4", "BN5", "BN6", "SF1"],
    mechanic: "Claims enemy panels. Later games add Grab Revenge / Stage Change.",
  },
  {
    id: "plus",
    label: "Plus / Navi+ / Atk+",
    games: ["BN2", "BN3", "BN4", "BN5", "BN6"],
    mechanic: "Permanent-for-the-fight attack buffs. Icon-only Plus type in later titles.",
  },
  {
    id: "fullcust",
    label: "Full Custom / FastGauge",
    games: ["BN3", "BN4", "BN5", "BN6"],
    mechanic: "Refills or accelerates the Custom Gauge.",
  },
  {
    id: "dark",
    label: "Dark / Evil chips",
    games: ["BN3", "BN4", "BN5"],
    mechanic: "Huge power; HP Bug / Dark Soul corruption. Restricted by emotion window or Dark Hole.",
  },
  {
    id: "soul",
    label: "Double Soul / Chaos Unison",
    games: ["BN4", "BN5"],
    mechanic: "Temporary fusion with another Navi's element and chip set. Chaos Unison is the dark inverse.",
  },
  {
    id: "cross",
    label: "Emotion Cross / Beast Out",
    games: ["BN6"],
    mechanic:
      "Heat, Elec, Slash, Erase, Charge, Spout, Tomahawk, Tengu, Ground, Dust. Beast Out adds a timed power window. Gregar / Falzar exclusive Giga chips.",
  },
  {
    id: "tag",
    label: "Tag chips",
    games: ["BN6"],
    mechanic: "Two operators share a Folder slot — the tagged chip appears for both.",
  },
  {
    id: "buster-mod",
    label: "Buster mods",
    games: ["BN1", "BN2", "BN3"],
    mechanic: "One Custom turn of Guard / Bomb / Sword / Punch on the B button.",
  },
  {
    id: "white-capsule",
    label: "White Capsule / NaviCust extras",
    games: ["BN3"],
    mechanic: "Style and NaviCust-adjacent programs that change how chips land.",
  },
]);

export const STAR_FORCE_FAMILY_ACCOUNT = /** @type {EchoFamilyAccount[]} */ ([
  {
    id: "plasma",
    label: "Plasma Gun",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Elec burst with lock-on. Signature Star Force gun family.",
    elementNote: "Elec.",
  },
  {
    id: "heat-upper",
    label: "Heat Upper",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Rising fire punch that lifts the locked target.",
    elementNote: "Fire.",
  },
  {
    id: "ice-needle",
    label: "Ice Needle",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Aqua needles that pin a locked panel.",
    elementNote: "Aqua.",
  },
  {
    id: "poison-fruit",
    label: "Poison Apple",
    games: ["SF1", "SF2"],
    mechanic: "Status fruit that ticks HP off the locked enemy.",
  },
  {
    id: "jet",
    label: "Jet Attack",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Rush the lock-on row; knockback.",
  },
  {
    id: "wide-wave",
    label: "Wide Wave",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Three-row sweeping wave. Aqua / Fire variants.",
  },
  {
    id: "magnum",
    label: "Magnum",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Heavy lock-on shot that ignores some shields.",
  },
  {
    id: "brother",
    label: "Brother Band card share",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "A linked friend contributes one extra card to the Custom draw.",
  },
  {
    id: "best-combo",
    label: "Best Combo",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Three same-name (or recipe) cards fuse into one named finisher.",
  },
  {
    id: "noise",
    label: "Noise Change",
    games: ["SF2"],
    mechanic: "EM noise remixes the card set and grants a Noise Force.",
  },
  {
    id: "tribe",
    label: "Tribe On",
    games: ["SF3"],
    mechanic: "Tribe cards (Taurus / Cygnus / Wolf / etc.) rewrite the next hand.",
  },
  {
    id: "star-force",
    label: "Star Force / Star Cards",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Version-exclusive Star Cards and the Star Force transformation finisher.",
  },
  {
    id: "meteor-g",
    label: "Meteor G",
    games: ["SF2", "SF3"],
    mechanic: "Sky-fall Giga that blankets the locked field.",
  },
  {
    id: "satellite",
    label: "Satellite flare",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "Fire / Aqua / Elec / Wood satellite-colored finishers.",
  },
  {
    id: "geo-bond",
    label: "EM Wave Change / Wizard bond",
    games: ["SF1", "SF2", "SF3"],
    mechanic: "The operator-Wizard fusion itself — Mega/Giga cards that play the bonded being.",
  },
]);

export function laterFamilyIds() {
  return BN_LATER_FAMILY_ACCOUNT.map((f) => f.id);
}

export function starForceFamilyIds() {
  return STAR_FORCE_FAMILY_ACCOUNT.map((f) => f.id);
}
