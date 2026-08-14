export const COMPOSITE_MAP_DIMENSIONS = {
  width: 2600,
  height: 1500,
};

const UNKNOWN_COLORS = ["#38bdf8", "#a78bfa", "#f59e0b", "#34d399", "#f472b6"];

export const KNOWN_WORLD_PROFILES = [
  {
    id: "korra-four-nations",
    name: "Avatar: Legend of Korra",
    label: "The Four Nations",
    matchTerms: ["avatar", "legend of korra", "korra", "tlok", "republic city"],
    color: "#38bdf8",
    bounds: { x: 160, y: 130, width: 760, height: 760 },
    summary:
      "Republic City connects the Water Tribes, Earth Kingdom, Fire Nation, Air Nation, and Spirit Wilds.",
    regions: [
      {
        id: "united-republic",
        name: "United Republic / Republic City",
        x: 505,
        y: 450,
        width: 230,
        height: 140,
        color: "#22d3ee",
        description:
          "Modern capital of technology, bending sport, politics, and Team Avatar's daily orbit.",
        keywords: ["korra", "asami", "mako", "bolin", "lin", "republic", "future industries"],
      },
      {
        id: "earth-kingdom",
        name: "Earth Kingdom",
        x: 650,
        y: 625,
        width: 310,
        height: 190,
        color: "#84cc16",
        description:
          "Vast continental power of metalbenders, lavabenders, monarchs, provinces, and reform movements.",
        keywords: ["earth", "beifong", "bolin", "kuvira", "zaofu", "metalbending", "lavabend"],
      },
      {
        id: "water-tribes",
        name: "Northern & Southern Water Tribes",
        x: 285,
        y: 650,
        width: 270,
        height: 165,
        color: "#60a5fa",
        description:
          "Polar homelands of waterbenders and Korra's Southern Water Tribe origin.",
        keywords: ["water", "southern water", "northern water", "korra", "tribe"],
      },
      {
        id: "fire-nation",
        name: "Fire Nation",
        x: 350,
        y: 260,
        width: 230,
        height: 150,
        color: "#f97316",
        description:
          "Island nation of firebenders whose legacy still shapes diplomacy and modern identity.",
        keywords: ["fire", "mako", "firebender"],
      },
      {
        id: "air-nation",
        name: "Air Nation",
        x: 725,
        y: 270,
        width: 220,
        height: 150,
        color: "#facc15",
        description:
          "Rebuilt temples, nomads, and new airbenders guided by Tenzin and Jinora.",
        keywords: ["air", "tenzin", "jinora", "zaheer", "airbender", "temple"],
      },
      {
        id: "spirit-wilds",
        name: "Spirit Wilds",
        x: 475,
        y: 790,
        width: 240,
        height: 120,
        color: "#c084fc",
        description:
          "Living overlap between human cities and the Spirit World after Harmonic Convergence.",
        keywords: ["spirit", "zaheer", "jinora", "harmonic convergence"],
      },
    ],
  },
  {
    id: "mcu-avengers-earth",
    name: "Marvel Cinematic Universe",
    label: "Avengers Earth & Cosmic Frontiers",
    matchTerms: ["marvel", "mcu", "avengers", "cinematic universe", "guardians of the galaxy"],
    color: "#ef4444",
    bounds: { x: 1010, y: 130, width: 930, height: 830 },
    summary:
      "Avengers stories center on the United States, with Wakanda, Asgard, the Eternals, and Guardians routes branching outward.",
    regions: [
      {
        id: "avengers-us",
        name: "United States / Avengers Corridor",
        x: 1325,
        y: 460,
        width: 360,
        height: 180,
        color: "#ef4444",
        description:
          "New York, Queens, Brooklyn, Avengers facilities, S.H.I.E.L.D., and the core US theaters for Earth's heroes.",
        keywords: [
          "tony",
          "stark",
          "steve",
          "rogers",
          "natasha",
          "banner",
          "peter parker",
          "nick fury",
          "new york",
          "brooklyn",
          "queens",
          "shield",
          "avengers",
        ],
      },
      {
        id: "wakanda-sokovia",
        name: "Wakanda & Sokovia",
        x: 1650,
        y: 675,
        width: 280,
        height: 160,
        color: "#a855f7",
        description:
          "Hidden Wakandan power, Sokovian trauma, and the geopolitical heart of several MCU arcs.",
        keywords: ["wakanda", "t'challa", "sokovia", "wanda", "maximoff", "vibranium"],
      },
      {
        id: "asgard-new-asgard",
        name: "Asgard / New Asgard",
        x: 1520,
        y: 260,
        width: 280,
        height: 145,
        color: "#facc15",
        description:
          "The realm and refugee settlement tied to Thor, Loki, and Asgardian mythic politics.",
        keywords: ["thor", "loki", "asgard", "odin", "mjolnir"],
      },
      {
        id: "eternals-earth",
        name: "Eternals Sites",
        x: 1170,
        y: 720,
        width: 280,
        height: 150,
        color: "#f59e0b",
        description:
          "Ancient and modern places touched by the Eternals' long watch over humanity.",
        keywords: ["eternal", "sersi", "ikaris", "thena", "gilgamesh", "kingo", "phastos", "makkari", "druig", "sprite", "ajak"],
      },
      {
        id: "cosmic-frontier",
        name: "Guardians Cosmic Frontier",
        x: 1820,
        y: 420,
        width: 250,
        height: 180,
        color: "#38bdf8",
        description:
          "Ravager routes, Knowhere, interstellar prisons, and the found-family orbit of the Guardians.",
        keywords: ["quill", "gamora", "drax", "rocket", "groot", "nebula", "mantis", "guardians", "space", "thanos"],
      },
    ],
  },
  {
    id: "invincible-earth",
    name: "Invincible",
    label: "Earth, Viltrum & Coalition Space",
    matchTerms: ["invincible", "viltrum", "omni-man", "atom eve", "global defense"],
    color: "#facc15",
    bounds: { x: 320, y: 930, width: 850, height: 390 },
    summary:
      "Earth's fragile defense network sits between Viltrumite conquest and Coalition resistance.",
    regions: [
      {
        id: "earth-gda",
        name: "Earth / Global Defense Agency",
        x: 620,
        y: 1125,
        width: 310,
        height: 155,
        color: "#facc15",
        description:
          "Mark's home, Cecil's operations, Teen Team history, and the main battlefield for Earth's defense.",
        keywords: ["mark", "debbie", "cecil", "rex", "william", "earth", "global defense"],
      },
      {
        id: "viltrum-empire",
        name: "Viltrumite Empire",
        x: 965,
        y: 1070,
        width: 250,
        height: 145,
        color: "#ef4444",
        description:
          "Conquest network behind Omni-Man and the imperial pressure hanging over Earth.",
        keywords: ["nolan", "omni", "viltrum", "empire"],
      },
      {
        id: "coalition-space",
        name: "Coalition of Planets",
        x: 910,
        y: 1245,
        width: 260,
        height: 120,
        color: "#22d3ee",
        description:
          "Alien resistance lanes and allies like Allen working against Viltrum.",
        keywords: ["allen", "coalition", "alien", "planets"],
      },
    ],
  },
  {
    id: "anima-inner-world",
    name: "Anima",
    label: "Anima Inner World",
    matchTerms: ["anima"],
    color: "#2dd4bf",
    bounds: { x: 1320, y: 1030, width: 520, height: 290 },
    summary:
      "Personal Anima companions gather in an inner symbolic landscape beside fictional universes.",
    regions: [
      {
        id: "inner-sanctum",
        name: "Inner Sanctum",
        x: 1580,
        y: 1175,
        width: 310,
        height: 150,
        color: "#2dd4bf",
        description:
          "A resonance field for user-created Animas, guardians, memories, and personal myth.",
        keywords: ["anima", "guardian", "muse", "companion"],
      },
    ],
  },
];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function slugify(value) {
  const slug = normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

function characterText(character) {
  return normalize(
    [
      character?.name,
      character?.universe,
      character?.category,
      character?.backstory,
      character?.personality,
    ].join(" "),
  );
}

function profileMatchesCharacter(profile, character) {
  const text = characterText(character);
  return profile.matchTerms.some((term) => text.includes(term));
}

function getKnownProfile(character) {
  return KNOWN_WORLD_PROFILES.find((profile) =>
    profileMatchesCharacter(profile, character),
  );
}

function createUnknownProfile(universe, index) {
  const row = Math.floor(index / 2);
  const column = index % 2;
  const color = UNKNOWN_COLORS[index % UNKNOWN_COLORS.length];
  const x = 1890 + column * 330;
  const y = 1010 + row * 210;
  const name = universe || "Unknown Universe";

  return {
    id: `custom-${slugify(name)}`,
    name,
    label: "Uncharted Universe",
    matchTerms: [normalize(name)],
    color,
    bounds: { x: x - 170, y: y - 110, width: 300, height: 180 },
    summary: "A user-created or newly discovered character universe added to the shared atlas.",
    regions: [
      {
        id: `${slugify(name)}-primary-realm`,
        name: `${name} Primary Realm`,
        x,
        y,
        width: 245,
        height: 120,
        color,
        description:
          "Generated atlas space for characters whose universe is not in the canonical starter map yet.",
        keywords: [normalize(name)],
      },
    ],
  };
}

function ensureWorld(worldsById, profile) {
  if (!worldsById.has(profile.id)) {
    worldsById.set(profile.id, {
      ...profile,
      characters: [],
      sourceUniverses: new Set(),
      regions: profile.regions.map((region) => ({
        ...region,
        characters: [],
        characterCount: 0,
      })),
    });
  }
  return worldsById.get(profile.id);
}

function findBestRegion(regions, character) {
  const text = characterText(character);
  return (
    regions.find((region) =>
      (region.keywords || []).some((keyword) => text.includes(normalize(keyword))),
    ) || regions[0]
  );
}

function mapSavedLocation(location, index) {
  const xCoord = Number.isFinite(Number(location?.x_coord))
    ? Number(location.x_coord)
    : (index * 29) % 100;
  const yCoord = Number.isFinite(Number(location?.y_coord))
    ? Number(location.y_coord)
    : (index * 17) % 100;

  return {
    ...location,
    mapX: 170 + (Math.max(0, Math.min(100, xCoord)) / 100) * 2260,
    mapY: 1345 + (Math.max(0, Math.min(100, yCoord)) / 100) * 95,
  };
}

export function createCompositeAtlas(characters = [], locations = []) {
  const worldsById = new Map();
  const unknownProfiles = new Map();

  for (const character of characters || []) {
    if (!character?.name) continue;
    let profile = getKnownProfile(character);
    if (!profile) {
      const universe = character.universe || "Unknown Universe";
      const key = slugify(universe);
      if (!unknownProfiles.has(key)) {
        unknownProfiles.set(key, createUnknownProfile(universe, unknownProfiles.size));
      }
      profile = unknownProfiles.get(key);
    }

    const world = ensureWorld(worldsById, profile);
    world.characters.push(character);
    if (character.universe) world.sourceUniverses.add(character.universe);

    const region = findBestRegion(world.regions, character);
    region.characters.push(character);
    region.characterCount = region.characters.length;
  }

  const worlds = [...worldsById.values()].map((world) => ({
    ...world,
    characterCount: world.characters.length,
    sourceUniverses: [...world.sourceUniverses],
  }));

  return {
    dimensions: COMPOSITE_MAP_DIMENSIONS,
    worlds,
    savedLocations: (locations || []).map(mapSavedLocation),
    totals: {
      worlds: worlds.length,
      characters: worlds.reduce((total, world) => total + world.characterCount, 0),
      savedLocations: locations?.length || 0,
    },
  };
}
