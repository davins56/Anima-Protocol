/**
 * Curated canonical stories from popular series
 * Each story is plot-aligned with the actual series narrative
 */

export const CANONICAL_STORIES = [
  {
    id: "hp-philosopher",
    universe: "Harry Potter",
    title: "The Boy Who Lived",
    book: "Philosopher's Stone",
    season: null,
    year: 1991,
    description: "Discover your magical abilities at Hogwarts alongside Harry Potter, Hermione Granger, and Ron Weasley. Your first year begins with the mysterious mystery of the Philosopher's Stone.",
    insertionPoints: [
      {
        id: "hp-p-arrival",
        title: "Arrival at Hogwarts",
        chapter: "Chapter 7: The Sorting Hat",
        narrative: "You step off the Hogwarts Express onto the platform. Hagrid calls out 'First years! First years this way!' The castle glows majestically ahead. Your magical journey is about to begin.",
        setting: "Hogsmeade Station, Evening",
      },
      {
        id: "hp-p-sorting",
        title: "The Sorting Ceremony",
        chapter: "Chapter 7: The Sorting Hat",
        narrative: "Professor McGonagall leads you into the Great Hall. Thousands of candles float above, and four long tables await. The Sorting Hat is placed on the stool. Your name will be called soon.",
        setting: "Hogwarts Great Hall",
      },
      {
        id: "hp-p-common-room",
        title: "First Night in Your House",
        chapter: "Chapter 8: The Potions Master",
        narrative: "You've been sorted and now stand in your house common room. The fireplace crackles, and older students welcome you. Tomorrow, classes begin. Tonight, the reality of magic settles in.",
        setting: "House Common Room, Night",
      },
    ],
    characters: ["Harry Potter", "Hermione Granger", "Ron Weasley", "Albus Dumbledore", "Severus Snape"],
    keyEvents: ["Sorting Ceremony", "First Flying Lesson", "Troll Encounter", "Philosopher's Stone Mystery"],
  },

  {
    id: "st-s1",
    universe: "Stranger Things",
    title: "When It Started",
    season: 1,
    year: 1983,
    description: "Arrive in Hawkins, Indiana as unexplainable events unfold. A boy goes missing, supernatural creatures emerge from another dimension, and government experiments come to light.",
    insertionPoints: [
      {
        id: "st-s1-arrival",
        title: "New to Hawkins",
        chapter: "Episode 1: The Vanishing",
        narrative: "You've just moved to the small town of Hawkins, Indiana. It seems peaceful enough—tree-lined streets, friendly neighbors, Byers' house on your block. But something feels off. Police sirens in the distance. Whispered conversations about a missing boy.",
        setting: "Hawkins, Indiana - Residential Street, 1983",
      },
      {
        id: "st-s1-discovery",
        title: "The Upside Down Revealed",
        chapter: "Episode 2: The Weirdo on Maple Street",
        narrative: "Strange things are happening. The power flickers. Mysterious lights in the woods. A girl with a shaved head appears in town—she's terrified, speaking only in whispers about 'the Upside Down.' Something isn't right in Hawkins.",
        setting: "Hawkins - Downtown & Woods, Night",
      },
    ],
    characters: ["Mike Wheeler", "Nancy Wheeler", "Jonathan Byers", "Joyce Byers", "Jim Hopper"],
    keyEvents: ["Will Byers Disappearance", "Eleven's Escape", "Dimension Portal", "Demogorgon Hunts"],
  },

  {
    id: "got-s1",
    universe: "Game of Thrones",
    title: "Winter is Coming",
    season: 1,
    year: null,
    description: "Enter the Seven Kingdoms as political intrigue deepens and ancient threats awaken. Join the Stark family as secrets unravel and war looms on the horizon.",
    insertionPoints: [
      {
        id: "got-s1-winterfell",
        title: "Summoned to Winterfell",
        chapter: "Episode 1: Winter is Coming",
        narrative: "King Robert Baratheon arrives at Winterfell with his court. The Stark family hosts the King and Queen. Dire wolves roam the grounds. Ancient secrets are whispered in stone halls. You've been invited to Winterfell, and nothing will be the same.",
        setting: "Winterfell, The North",
      },
      {
        id: "got-s1-kingslanding",
        title: "Arrival in King's Landing",
        chapter: "Episode 2: The Kingsroad",
        narrative: "The capital sprawls before you—golden and grand, yet seething with danger. Nobles scheme in shadows. The throne holds secrets. The Lannisters are in power. King's Landing will test your wits and your survival instincts.",
        setting: "King's Landing, The Crownlands",
      },
    ],
    characters: ["Ned Stark", "Catelyn Stark", "Jon Snow", "Daenerys Targaryen", "Tyrion Lannister"],
    keyEvents: ["King's Arrival", "Bran's Fall", "Daenerys' Wedding", "Stark Betrayal", "Throne War Begins"],
  },

  {
    id: "tlou-outbreak",
    universe: "The Last of Us",
    title: "Outbreak",
    year: 2013,
    description: "Survive the first days of the fungal outbreak. The world collapses into chaos as infected roam the cities. Humanity struggles to survive in a new, hostile world.",
    insertionPoints: [
      {
        id: "tlou-outbreak-day0",
        title: "The First Day",
        chapter: "Episode 1: When You're Lost in the Darkness",
        narrative: "The news reports something strange. Power outages. Riots. People on the streets acting violently, biting others. Someone in your family is sick—their eyes are wrong. Something catastrophic is happening.",
        setting: "Urban City - Morning of Outbreak",
      },
      {
        id: "tlou-outbreak-shelter",
        title: "Finding Shelter",
        chapter: "Episode 1: When You're Lost in the Darkness",
        narrative: "Sirens wail. The military arrives, separating people. You've escaped into a building with a stranger who survived the first waves. Outside, infected pound at windows. You need to survive the night.",
        setting: "Abandoned Building, First Night",
      },
    ],
    characters: ["Joel Miller", "Ellie Williams", "Marlene", "Tommy", "Maria"],
    keyEvents: ["Outbreak Begins", "Military Lockdown", "First Infected Encounter", "Quarantine Zone Collapse"],
  },

  {
    id: "mcu-avengers",
    universe: "Marvel Cinematic Universe",
    title: "Avengers Assemble",
    year: 2012,
    description: "Witness the first assembly of Earth's mightiest heroes. Aliens invade New York. The world will never be the same. Join the battle that changes everything.",
    insertionPoints: [
      {
        id: "mcu-shield-recruit",
        title: "Recruited by S.H.I.E.L.D.",
        chapter: "Pre-Avengers: Agent Assignment",
        narrative: "A knock on your door. A man in a suit identifies himself as S.H.I.E.L.D. They need people with your skills. The world is under threat. They're assembling a team. Your life is about to change.",
        setting: "Unknown Location - S.H.I.E.L.D. Base",
      },
      {
        id: "mcu-invasion",
        title: "The Invasion Begins",
        chapter: "Avengers: New York Battle",
        narrative: "The sky opens. Alien ships descend on New York City. Iron Man flies overhead. Captain America directs teams below. You're in the chaos—sirens wailing, buildings collapsing, heroes fighting overhead. This is happening. Now.",
        setting: "New York City - Under Attack",
      },
    ],
    characters: ["Tony Stark", "Steve Rogers", "Natasha Romanoff", "Clint Barton", "Bruce Banner"],
    keyEvents: ["Loki's Arrival", "Portal Opens", "Battle of New York", "Avengers Form", "Alien Defeat"],
  },

  {
    id: "witcher-white-wolf",
    universe: "The Witcher",
    title: "Path of the White Wolf",
    year: null,
    description: "Enter a world of monsters, magic, and moral ambiguity. Travel the Continent with Geralt of Rivia. Every contract holds danger. Every choice has consequences.",
    insertionPoints: [
      {
        id: "witcher-tavern",
        title: "Meeting in the Tavern",
        chapter: "Chapter 1: White Wolf",
        narrative: "You're in a tavern in a small town. A scarred white-haired man sits in the corner—a witcher. Locals eye him with fear and suspicion. He's hunting something. The tavern keeper asks if you've seen any signs of monsters. Trouble is coming.",
        setting: "Local Tavern - Evening",
      },
      {
        id: "witcher-contract",
        title: "Taking a Contract",
        chapter: "Chapter 1: The Contract",
        narrative: "A nobleman approaches. His daughter is missing. Strange tracks in the forest. He's offering gold for anyone brave enough to investigate. Geralt is considering it. The pay is good, but so is the risk. Will you join him?",
        setting: "Nobleman's Manor - Study",
      },
    ],
    characters: ["Geralt of Rivia", "Yennefer of Vengerberg", "Ciri", "Dandelion", "Triss Merigold"],
    keyEvents: ["Monster Hunts Begin", "Magic Revealed", "Prophecy Unfolds", "Wild Hunt Awakens", "Destiny Converges"],
  },

  {
    id: "mmbn-net-battle",
    universe: "Megaman Battle Network",
    title: "Net Battler Emerges",
    year: 2002,
    description: "Step into the digital world of cyberspace. You're a NetNavi operator—your partner AI fights in cyberspace while you provide support. Viruses threaten the network. The fate of the digital world rests in your hands.",
    insertionPoints: [
      {
        id: "mmbn-first-jack-in",
        title: "First Jack In",
        chapter: "Chapter 1: A New NetNavi",
        narrative: "Lan hands you a PET device—a Personal Terminal. Inside is your NetNavi, ready to dive into cyberspace. The digital world sprawls before you on the screen. Your first jack-in awaits. Viruses are spreading through the network.",
        setting: "School Computer Lab",
      },
      {
        id: "mmbn-virus-battle",
        title: "First Virus Battle",
        chapter: "Chapter 2: Virus Busting",
        narrative: "A virus signature flares on your PET's screen. Your NetNavi stands ready in cyberspace. You'll command them in real-time, sending battle chips and codes to defeat the digital enemy. This is what it means to be a Net Battler.",
        setting: "Cyberspace - Network Node",
      },
    ],
    characters: ["Megaman.EXE", "Lan Hikari", "Roll.EXE", "ChipMan.EXE", "Dr. Hikari"],
    keyEvents: ["First Virus Battle", "Shadowman Virus", "Gospel Awakens", "Cyberworld Crisis", "NetNavi Evolution"],
  },

  {
    id: "naruto-shinobi",
    universe: "Naruto",
    title: "Way of the Shinobi",
    year: 1999,
    description: "Become a ninja in the hidden villages. Master jutsu, train your chakra, and forge bonds with your team. War looms on the horizon. The fate of the ninja world is uncertain.",
    insertionPoints: [
      {
        id: "naruto-academy",
        title: "Entering the Ninja Academy",
        chapter: "Episode 1: Enter: Naruto Uzumaki",
        narrative: "You step through the gates of the Ninja Academy in your village. Other young students gather, nervous and excited. Instructors observe you carefully. Today, your training as a shinobi begins. Your path to becoming a true ninja starts here.",
        setting: "Hidden Leaf Village - Ninja Academy",
      },
      {
        id: "naruto-team-formation",
        title: "Team Formation",
        chapter: "Chapter 7: A New Start",
        narrative: "The instructor announces the three-person teams. You're grouped with powerful shinobi. A jounin instructor approaches—your sensei. Together, you'll take missions, grow stronger, and discover what it truly means to protect those you care about.",
        setting: "Ninja Academy - Main Hall",
      },
    ],
    characters: ["Naruto Uzumaki", "Sasuke Uchiha", "Sakura Haruno", "Kakashi Hatake", "Jiraiya"],
    keyEvents: ["Chunin Exams", "Itachi Returns", "Akatsuki Threat", "Great War Begins", "Ninja Legacy"],
  },

  {
    id: "tvd-mystic-falls",
    universe: "The Vampire Diaries",
    title: "Mystic Falls",
    year: 2009,
    description: "Welcome to Mystic Falls—a town where vampires, witches, and werewolves hide in plain sight. Supernatural danger lurks beneath the surface. One wrong move could expose the secrets that keep this town alive.",
    insertionPoints: [
      {
        id: "tvd-arrival",
        title: "New to Mystic Falls",
        chapter: "Episode 1: Pilot",
        narrative: "You've just moved to Mystic Falls, Virginia. It's a quiet, picturesque town—charming old houses, historic atmosphere. But Elena approaches you with a warning in her eyes: not everything in Mystic Falls is what it seems. There's danger here. Real danger.",
        setting: "Mystic Falls - Main Street",
      },
      {
        id: "tvd-party",
        title: "At the Salvatore House",
        chapter: "Episode 3: Friday Night Bites",
        narrative: "You're invited to a party at an elegant mansion. The Salvatore brothers play the perfect hosts. But you catch glimpses of something dark—supernatural. Someone's eyes flash red in the darkness. You wonder who in this room is truly human.",
        setting: "Salvatore Mansion - Evening",
      },
    ],
    characters: ["Elena Gilbert", "Damon Salvatore", "Stefan Salvatore", "Bonnie Bennett", "Katherine Pierce"],
    keyEvents: ["Vampire Reveal", "Doppelgangers", "The Other Side", "Mystical War", "Sacrifice Season"],
  },

  {
    id: "invincible-superhero",
    universe: "Invincible",
    title: "Rise of the Invincible",
    year: 2005,
    description: "Mark Grayson is learning what it means to be a superhero—and his father's dark secret. Join a new generation of heroes navigating power, responsibility, and impossible choices.",
    insertionPoints: [
      {
        id: "invincible-first-flight",
        title: "First Powers Manifest",
        chapter: "Chapter 1: Who Am I?",
        narrative: "You feel it—a surge of power coursing through your body. Suddenly, you can lift things that should be impossible. You're stronger than ever before. Omni-Man watches from nearby with a knowing look. Welcome to your new life.",
        setting: "Mark's School - Rooftop",
      },
      {
        id: "invincible-first-mission",
        title: "First Mission",
        chapter: "Chapter 3: Making the Grade",
        narrative: "Superheroes are being recruited. You're asked to join the Guardians of the Globe, Earth's mightiest heroes. But war is coming. The heroes sense it. Alien threats loom on the horizon. Are you ready for what's ahead?",
        setting: "Guardian Headquarters",
      },
    ],
    characters: ["Mark Grayson", "Omni-Man", "Debbie Grayson", "Monster Girl", "Rex Splode"],
    keyEvents: ["Viltrumite Arrival", "Truth Revealed", "World Threatened", "Heroes Fall", "New Order Rises"],
  },

  {
    id: "korra-avatar",
    universe: "The Legend of Korra",
    title: "The Avatar Returns",
    year: 2012,
    description: "The Avatar has returned. Korra, a young Avatar from the Southern Water Tribe, arrives in Republic City. A new threat emerges. The balance of the world hangs in the balance.",
    insertionPoints: [
      {
        id: "korra-republic-city",
        title: "Arrival in Republic City",
        chapter: "Episode 1: Welcome to Republic City",
        narrative: "Republic City sprawls before you—a metropolis of earthbenders, waterbenders, firebenders, and airbenders living together. But something is wrong. An anti-bending movement gains power. The Avatar arrives, and with her, hope. Or perhaps chaos.",
        setting: "Republic City - Harbor",
      },
      {
        id: "korra-pro-bending",
        title: "Pro-Bending Tournament",
        chapter: "Episode 3: The Revelation",
        narrative: "Korra invites you to watch the Pro-Bending Tournament—the greatest bending competition in the world. Teams of three benders clash in an arena. The energy is electric. But beneath the excitement, darker forces are at work.",
        setting: "Pro-Bending Arena",
      },
    ],
    characters: ["Korra", "Asami Sato", "Mako", "Bolin", "Tenzin"],
    keyEvents: ["Anti-Bending Movement", "Spirit World Opens", "Vaatu Awakens", "Darkness Descends", "New Avatar Era"],
  },
];

export const UNIVERSE_CATEGORIES = {
  fantasy: ["Harry Potter", "Game of Thrones", "The Witcher", "The Legend of Korra"],
  scifi: ["Stranger Things", "Marvel Cinematic Universe", "Invincible"],
  horror: ["The Last of Us", "The Vampire Diaries"],
  adventure: ["Marvel Cinematic Universe", "The Witcher", "Naruto", "Megaman Battle Network", "The Legend of Korra"],
  anime: ["Naruto", "Megaman Battle Network", "The Legend of Korra"],
  superhero: ["Invincible", "Marvel Cinematic Universe"],
  supernatural: ["The Vampire Diaries", "The Legend of Korra"],
};

export function getStoryByUniverse(universe) {
  return CANONICAL_STORIES.filter(
    (story) => story.universe.toLowerCase() === universe.toLowerCase()
  );
}

export function getUniverses() {
  return [...new Set(CANONICAL_STORIES.map((s) => s.universe))];
}