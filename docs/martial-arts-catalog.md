# Martial arts seed catalog v1.1 (#768)

Status: the data behind `lib/martial-core` (`@workspace/martial-core`, `src/library.seed.ts`), behind the `ANIMA_MARTIAL_ARTS` flag (off by default). Design and decisions: [#768](https://github.com/davins56/Anima-Protocol/issues/768). Every entry is `source: "seed"`; davins56's own styles will be added later as `source: "user"` and extend this catalog (D1), never replace it (user ids are `u_*`). User-written style text is untrusted data: it can't supply rules or modifiers, and user-style battle effects are derived and clamped exactly like seed ones.

`lib/martial-core/test/library.test.ts` checks that every style id, variant id and battle line below matches the code.

- **63 styles, 106 variants.** Summaries are short factual descriptions; the sources listed for each style are where they can be checked (Wikipedia plus governing bodies or UNESCO listings where they exist). All source URLs were checked to resolve on 2026-11-15, with redirects and disambiguation pages fixed.
- **Trait mapping:** the 0–3 weights on the ten selection axes (aggression, patience, precision, flow, control, cunning, grit, tradition, pragmatism, rhythm) used by the §4 selection. A variant's tilt is added to its style's weights.
- **Battle effects** are derived from the axes, kind and range. `strike`, `weapon` and `guard` are multipliers clamped to [0.85, 1.15]; `guard` multiplies incoming damage, so below 1 means she takes less. `control` is 0–3 ticks of enemy delay. These are clamped on the server on write and again in sim-core on read (D4, K4).
- **Left out on purpose:** Jeet Kune Do / Jun Fan (trademark holder); Gracie-branded jiu-jitsu (trademark); Shorinji Kempo (trademark); Bujinkan-style ninjutsu (organisation-branded); Kudo / Daido Juku (organisation-branded). No franchise content.

## How it's used

- **Selection** (`select.ts`): a ten-axis trait vector from the anima's own personality fields, cosine score × 100, styles she's explicitly named in her history first (+40), then a seeded tie-break `fnv1a(fnv1a(characterId | library_version) | style_id)`. Re-roll cycles her top five. Same inputs, same result, in Node and the browser.
- **Explanation** (`explain.ts`): template text in her register (formal, terse, playful, warm, poetic, plain), ≤ 280 chars, no emotion words, no model call.
- **Battle effects** (`battle.ts`): style plus tone clamped together: strike, weapon and guard in [0.85, 1.15] (guard multiplies incoming damage), control 0–3 ticks, NetBattle-only speed in [0.85, 1.15], no 4D tempo knob. Unknown ids and malformed or NaN values give the neutral result.
- **Tone** (`tone.ts`): only from the public affect layer (`layer: "public"`); `composed` when emotions are off.
- **Narration** (`narrate.ts`, `techniques.ts`): plain technique lines for the navi's actions and one stance line for Aetherial Net encounters. Narration never changes an encounter's outcome.

## Boxing (`boxing`)

- **Family / kind / range:** western_combat_sports · striking · mid
- **Description:** Punch-only combat sport built on footwork, head movement and combinations.
- **Trait mapping:** aggression 2, precision 1, grit 2, rhythm 1
- **Battle effects:** strike ×1.08, weapon ×1.01, guard ×1.01, control 0, weapon chips cannon
- **Variants:**
  - `out_boxer` **Out-boxer**: Keeps range with the jab and footwork. (tilt: precision +1, patience +1)
  - `swarmer` **Swarmer (pressure fighter)**: Closes distance and throws volume in close. (tilt: aggression +1, grit +1)
  - `counterpuncher` **Counterpuncher**: Waits for the opponent's mistake and punishes it. (tilt: patience +1, cunning +1)
  - `shoulder_roll` **Shoulder-roll defence**: Lead shoulder deflects punches; counters off the roll. (tilt: cunning +1, precision +1)
- **Sources:** <https://en.wikipedia.org/wiki/Boxing> · <https://en.wikipedia.org/wiki/Boxing_styles_and_technique>

## Muay Thai (`muay_thai`)

- **Family / kind / range:** southeast_asian_striking · striking · clinch
- **Description:** Thai 'art of eight limbs': punches, elbows, knees, kicks and the clinch.
- **Trait mapping:** aggression 3, grit 3, tradition 1, rhythm 1
- **Battle effects:** strike ×1.12, weapon ×1.0, guard ×1.015, control 1
- **Variants:**
  - `muay_femur` **Muay Femur**: Technical, timing-based fighter who scores cleanly. (tilt: precision +1, patience +1)
  - `muay_khao` **Muay Khao**: Knee fighter who lives in the clinch. (tilt: grit +1, control +1)
  - `muay_mat` **Muay Mat**: Heavy hands and forward pressure. (tilt: aggression +1)
  - `muay_boran` **Muay Boran**: Umbrella term for the older, traditional forms. (tilt: tradition +2)
- **Sources:** <https://en.wikipedia.org/wiki/Muay_Thai> · <https://en.wikipedia.org/wiki/Muay_boran>

## Lethwei (`lethwei`)

- **Family / kind / range:** southeast_asian_striking · striking · clinch
- **Description:** Burmese bare-knuckle boxing that also allows headbutts.
- **Trait mapping:** aggression 3, grit 3, tradition 1, pragmatism 1
- **Battle effects:** strike ×1.12, weapon ×1.0, guard ×1.015, control 1
- **Variants:**
  - `traditional` **Traditional rules**: Knockout-only bouts in the traditional format. (tilt: tradition +1)
  - `modern` **Modern ring rules**: Contemporary rule set with scoring and rounds. (tilt: precision +1)
- **Sources:** <https://en.wikipedia.org/wiki/Lethwei>

## Kickboxing (`kickboxing`)

- **Family / kind / range:** western_combat_sports · striking · mid
- **Description:** Ring sport of punches and kicks; styles differ in permitted targets and techniques.
- **Trait mapping:** aggression 2, flow 1, grit 1, rhythm 1
- **Battle effects:** strike ×1.07, weapon ×1.0, guard ×1.02, control 0, weapon chips cannon
- **Variants:**
  - `dutch` **Dutch style**: Punch-kick combinations, low kicks, high work rate. (tilt: aggression +1)
  - `american_full_contact` **American full-contact**: Kicks above the waist only, boxing-heavy. (tilt: precision +1)
  - `japanese` **Japanese kickboxing**: Origin of the term; Muay Thai-influenced rules. (tilt: grit +1)
- **Sources:** <https://en.wikipedia.org/wiki/Kickboxing>

## Savate (`savate`)

- **Family / kind / range:** western_combat_sports · striking · long
- **Description:** French boxing combining punches with shoe-tip kicks.
- **Trait mapping:** precision 2, flow 1, tradition 1, rhythm 2
- **Battle effects:** strike ×1.0, weapon ×1.02, guard ×1.0, control 0, weapon chips cannon, crack_shot
- **Variants:**
  - `combat` **Savate de combat**: Full-contact, self-defence-oriented form. (tilt: pragmatism +1)
  - `assaut` **Assaut**: Controlled-contact competition emphasising technique. (tilt: precision +1)
- **Sources:** <https://en.wikipedia.org/wiki/Savate>

## Taekwondo (`taekwondo`)

- **Family / kind / range:** korean_arts · striking · long
- **Description:** Korean art known for fast, high and spinning kicks.
- **Trait mapping:** precision 2, flow 2, tradition 1, rhythm 1
- **Battle effects:** strike ×1.0, weapon ×1.02, guard ×1.0, control 0, weapon chips cannon, crack_shot
- **Variants:**
  - `olympic` **Olympic-style sparring**: Electronic-scored kicking contest. (tilt: precision +1, rhythm +1)
  - `itf` **ITF patterns and sparring**: Patterns (tul) and semi-contact sparring with hand techniques. (tilt: tradition +1)
- **Sources:** <https://en.wikipedia.org/wiki/Taekwondo> · <https://www.worldtaekwondo.org/>

## Karate (`karate`)

- **Family / kind / range:** okinawan_japanese_karate · striking · mid
- **Description:** Okinawan-Japanese striking art trained through kihon, kata and kumite.
- **Trait mapping:** patience 1, precision 2, grit 1, tradition 3
- **Battle effects:** strike ×1.0, weapon ×1.02, guard ×0.965, control 0, weapon chips cannon
- **Variants:**
  - `shotokan` **Shotokan**: Long, deep stances and linear power. (tilt: precision +1)
  - `kyokushin` **Kyokushin**: Full-contact knockdown fighting and hard conditioning. (tilt: grit +2, aggression +1)
  - `goju_ryu` **Goju-ryu**: Hard-soft close range with breathing (Sanchin). (tilt: patience +1, control +1)
  - `wado_ryu` **Wado-ryu**: Evasion and body shifting; jujutsu influence. (tilt: flow +1, cunning +1)
  - `shito_ryu` **Shito-ryu**: Very broad kata syllabus from Shuri and Naha lines. (tilt: tradition +1)
  - `uechi_ryu` **Uechi-ryu**: Okinawan style with heavy conditioning and close techniques. (tilt: grit +1)
- **Sources:** <https://en.wikipedia.org/wiki/Karate> · <https://en.wikipedia.org/wiki/Shotokan> · <https://en.wikipedia.org/wiki/Kyokushin> · <https://en.wikipedia.org/wiki/G%C5%8Dj%C5%AB-ry%C5%AB> · <https://en.wikipedia.org/wiki/Wad%C5%8D-ry%C5%AB> · <https://en.wikipedia.org/wiki/Shit%C5%8D-ry%C5%AB> · <https://en.wikipedia.org/wiki/Uechi-Ry%C5%AB>

## Sanda (Sanshou) (`sanda`)

- **Family / kind / range:** chinese_combat_sports · hybrid · mid
- **Description:** Chinese kickboxing with catch-kicks and throws.
- **Trait mapping:** aggression 1, flow 1, grit 1, pragmatism 2
- **Battle effects:** strike ×1.04, weapon ×1.0, guard ×1.005, control 0, weapon chips cannon
- **Variants:**
  - `sport` **Sport sanda**: Platform-based competition with throws for points.
- **Sources:** <https://en.wikipedia.org/wiki/Sanda_(sport)>

## Wing Chun (`wing_chun`)

- **Family / kind / range:** chinese_southern · striking · close
- **Description:** Southern close-range system: centreline structure, simultaneous block-and-strike and chi sau sensitivity drills.
- **Trait mapping:** patience 1, precision 3, control 2, pragmatism 1
- **Battle effects:** strike ×0.99, weapon ×1.03, guard ×0.935, control 2
- **Variants:**
  - `yip_man_lineage` **Yip Man lineage**: The widely spread Hong Kong lineage.
  - `pan_nam` **Pan Nam lineage**: Foshan lineage with its own forms. (tilt: tradition +1)
  - `hung_fa_yi` **Hung Fa Yi**: Lineage emphasising geometric principles. (tilt: precision +1)
- **Sources:** <https://en.wikipedia.org/wiki/Wing_Chun>

## Hung Ga (`hung_ga`)

- **Family / kind / range:** chinese_southern · striking · mid
- **Description:** Southern style with low, rooted stances and powerful hand techniques.
- **Trait mapping:** aggression 1, grit 3, tradition 3
- **Battle effects:** strike ×1.06, weapon ×1.0, guard ×0.985, control 0, weapon chips cannon
- **Variants:**
  - `tiger_crane` **Tiger-Crane form**: Signature form pairing tiger power and crane precision. (tilt: precision +1)
  - `iron_wire` **Iron Wire form**: Internal-strength and conditioning form. (tilt: patience +1)
- **Sources:** <https://en.wikipedia.org/wiki/Hung_Ga>

## Choy Li Fut (`choy_li_fut`)

- **Family / kind / range:** chinese_southern · striking · long
- **Description:** Southern style with wide swinging and hooking strikes and mobile footwork.
- **Trait mapping:** aggression 2, flow 2, rhythm 1
- **Battle effects:** strike ×1.06, weapon ×1.0, guard ×1.03, control 0, weapon chips cannon, crack_shot
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Choy_Li_Fut>

## Northern Shaolin / Long Fist (`changquan`)

- **Family / kind / range:** chinese_northern · striking · long
- **Description:** Extended, acrobatic movement and long-range kicks.
- **Trait mapping:** precision 1, flow 2, tradition 2, rhythm 1
- **Battle effects:** strike ×1.0, weapon ×1.01, guard ×1.0, control 0, weapon chips cannon, crack_shot
- **Variants:**
  - `changquan` **Changquan (Long Fist)**: Long, extended techniques; a basis of modern wushu. (tilt: rhythm +1)
  - `northern_shaolin` **Northern Shaolin**: Traditional northern forms associated with Shaolin. (tilt: tradition +1)
- **Sources:** <https://en.wikipedia.org/wiki/Changquan> · <https://en.wikipedia.org/wiki/Northern_Shaolin_kung_fu>

## Praying Mantis (`mantis`)

- **Family / kind / range:** chinese_northern · striking · close
- **Description:** Hooking hands and rapid trapping combinations.
- **Trait mapping:** precision 2, flow 1, cunning 2
- **Battle effects:** strike ×1.0, weapon ×1.02, guard ×1.0, control 0
- **Variants:**
  - `seven_star` **Seven Star Mantis**: Fast, linear combinations. (tilt: aggression +1)
  - `six_harmony` **Six Harmony Mantis**: More internal, softer expression. (tilt: patience +1)
  - `southern` **Southern Mantis**: Hakka close-range style; separate origin from the northern styles. (tilt: control +1)
- **Sources:** <https://en.wikipedia.org/wiki/Northern_Praying_Mantis> · <https://en.wikipedia.org/wiki/Southern_Praying_Mantis>

## Baguazhang (`baguazhang`)

- **Family / kind / range:** chinese_internal · hybrid · mid
- **Description:** Internal art of circle-walking, palm changes and evasive footwork.
- **Trait mapping:** patience 1, flow 3, cunning 2
- **Battle effects:** strike ×0.99, weapon ×1.0, guard ×0.975, control 0, weapon chips cannon
- **Variants:**
  - `cheng` **Cheng style**: Smooth, spiralling palm changes. (tilt: flow +1)
  - `yin` **Yin style**: Sharper, striking-oriented expression. (tilt: aggression +1)
- **Sources:** <https://en.wikipedia.org/wiki/Baguazhang>

## Xingyiquan (`xingyiquan`)

- **Family / kind / range:** chinese_internal · striking · close
- **Description:** Internal art of linear, explosive advancing strikes.
- **Trait mapping:** aggression 2, precision 2, tradition 1
- **Battle effects:** strike ×1.06, weapon ×1.02, guard ×1.03, control 0
- **Variants:**
  - `five_elements` **Five Elements**: Five core fists (splitting, drilling, crushing, pounding, crossing). (tilt: precision +1)
  - `twelve_animals` **Twelve Animals**: Animal-based forms built on the five fists. (tilt: flow +1)
- **Sources:** <https://en.wikipedia.org/wiki/Xingyiquan>

## Tai Chi (Taijiquan) (`taijiquan`)

- **Family / kind / range:** chinese_internal · hybrid · close
- **Description:** Internal art practised widely for health; martial use relies on yielding, push hands and redirection.
- **Trait mapping:** patience 3, flow 1, control 2, tradition 1
- **Battle effects:** strike ×0.97, weapon ×1.0, guard ×0.885, control 2
- **Variants:**
  - `chen` **Chen style**: Oldest family style, with fa jin bursts. (tilt: aggression +1)
  - `yang` **Yang style**: Slow, even, large frame; most practised. (tilt: patience +1)
  - `wu` **Wu style**: Compact frame, forward lean. (tilt: control +1)
  - `sun` **Sun style**: Agile steps; blends xingyi and bagua ideas. (tilt: flow +1)
- **Sources:** <https://en.wikipedia.org/wiki/Tai_chi>

## Bajiquan (`bajiquan`)

- **Family / kind / range:** chinese_northern · striking · close
- **Description:** Explosive short-range elbow and shoulder strikes.
- **Trait mapping:** aggression 3, grit 1, pragmatism 1
- **Battle effects:** strike ×1.1, weapon ×1.0, guard ×1.035, control 0
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Bajiquan>

## Brazilian Jiu-Jitsu (`bjj`)

- **Family / kind / range:** grappling_arts · grappling · ground
- **Description:** Ground fighting built on positional control and submissions.
- **Trait mapping:** patience 2, control 3, cunning 1, grit 1
- **Battle effects:** strike ×0.99, weapon ×1.0, guard ×0.88, control 3
- **Variants:**
  - `gi` **Gi**: Grip-based game with the jacket. (tilt: patience +1)
  - `no_gi` **No-gi**: Faster scrambles and leg locks without the jacket. (tilt: flow +1)
  - `self_defence` **Self-defence oriented**: Takedowns, clinch safety and strikes awareness. (tilt: pragmatism +1)
- **Sources:** <https://en.wikipedia.org/wiki/Brazilian_jiu-jitsu>

## Judo (`judo`)

- **Family / kind / range:** japanese_budo · grappling · clinch
- **Description:** Throws, pins and submissions through kuzushi (unbalancing).
- **Trait mapping:** precision 1, control 2, grit 1, tradition 2
- **Battle effects:** strike ×1.01, weapon ×1.01, guard ×0.95, control 2
- **Variants:**
  - `tachi_waza` **Tachi-waza**: Standing throws. (tilt: precision +1)
  - `ne_waza` **Ne-waza**: Groundwork: pins, chokes, armlocks. (tilt: control +1)
  - `kata` **Kata**: Formal prearranged forms. (tilt: tradition +1)
- **Sources:** <https://en.wikipedia.org/wiki/Judo> · <https://www.ijf.org/>

## Wrestling (`wrestling`)

- **Family / kind / range:** grappling_arts · grappling · clinch
- **Description:** Takedowns, control and pins.
- **Trait mapping:** aggression 1, control 2, grit 3
- **Battle effects:** strike ×1.06, weapon ×1.0, guard ×0.945, control 2
- **Variants:**
  - `freestyle` **Freestyle**: Leg attacks allowed; exposure scoring. (tilt: flow +1)
  - `greco_roman` **Greco-Roman**: Upper body only; big throws. (tilt: aggression +1)
  - `folkstyle` **Folkstyle (collegiate)**: Control-and-riding emphasis. (tilt: control +1)
  - `catch` **Catch wrestling**: Submission-oriented historical style. (tilt: cunning +1)
- **Sources:** <https://en.wikipedia.org/wiki/Wrestling> · <https://en.wikipedia.org/wiki/Catch_wrestling> · <https://uww.org/>

## Sambo (`sambo`)

- **Family / kind / range:** grappling_arts · grappling · clinch
- **Description:** Soviet-origin grappling with leg locks; combat Sambo adds strikes.
- **Trait mapping:** control 1, grit 2, pragmatism 2
- **Battle effects:** strike ×1.02, weapon ×1.0, guard ×0.96, control 2
- **Variants:**
  - `sport` **Sport Sambo**: Throws and leg locks; no chokes. (tilt: control +1)
  - `combat` **Combat Sambo**: Adds strikes and chokes. (tilt: aggression +1)
- **Sources:** <https://en.wikipedia.org/wiki/Sambo_(martial_art)>

## Aikido (`aikido`)

- **Family / kind / range:** japanese_budo · grappling · close
- **Description:** Blending with an attack and redirecting it into throws and joint locks.
- **Trait mapping:** patience 2, flow 1, control 3
- **Battle effects:** strike ×0.98, weapon ×1.0, guard ×0.89, control 2
- **Variants:**
  - `aikikai` **Aikikai**: Mainstream organisation; flowing practice. (tilt: flow +1)
  - `yoshinkan` **Yoshinkan**: Precise, hard-edged basics. (tilt: precision +1)
  - `shodokan` **Shodokan (Tomiki)**: Includes competitive randori. (tilt: grit +1)
- **Sources:** <https://en.wikipedia.org/wiki/Aikido>

## Hapkido (`hapkido`)

- **Family / kind / range:** korean_arts · hybrid · close
- **Description:** Korean art of joint locks, throws and kicks.
- **Trait mapping:** flow 1, control 2, pragmatism 1
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×0.96, control 2
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Hapkido>

## Japanese Jujutsu (`jujutsu`)

- **Family / kind / range:** japanese_budo · grappling · close
- **Description:** Classical close combat: throws, locks and strikes.
- **Trait mapping:** control 2, tradition 2, pragmatism 1
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×0.96, control 2
- **Variants:**
  - `koryu` **Koryu (classical)**: Pre-modern schools studied through kata. (tilt: tradition +1)
  - `modern` **Modern self-defence**: Contemporary syllabus for self-protection. (tilt: pragmatism +1)
- **Sources:** <https://en.wikipedia.org/wiki/Jujutsu>

## Sumo (`sumo`)

- **Family / kind / range:** japanese_budo · grappling · clinch
- **Description:** Push, grip or throw the opponent out of the ring.
- **Trait mapping:** aggression 2, grit 2, tradition 2
- **Battle effects:** strike ×1.08, weapon ×1.0, guard ×1.01, control 1
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Sumo>

## Krav Maga (`krav_maga`)

- **Family / kind / range:** self_defence · hybrid · close
- **Description:** Self-defence system: simultaneous defence and counter, situational awareness.
- **Trait mapping:** aggression 2, pragmatism 3
- **Battle effects:** strike ×1.06, weapon ×1.0, guard ×1.03, control 0
- **Variants:**
  - `civilian` **Civilian**: Self-defence for everyday threats. (tilt: patience +1)
  - `professional` **Professional**: Military and law-enforcement curricula. (tilt: aggression +1)
- **Sources:** <https://en.wikipedia.org/wiki/Krav_Maga>

## Mixed Martial Arts (`mma`)

- **Family / kind / range:** modern_combat_sports · hybrid · mid
- **Description:** Combined striking and grappling for all ranges.
- **Trait mapping:** flow 1, grit 2, pragmatism 2
- **Battle effects:** strike ×1.02, weapon ×1.0, guard ×0.98, control 0, weapon chips cannon
- **Variants:**
  - `wrestle_boxer` **Wrestle-boxer**: Takedown threat plus boxing. (tilt: control +1)
  - `striker` **Striker**: Stays standing; kicks and punches. (tilt: aggression +1)
  - `grappler` **Grappler**: Takes it to the ground for submissions. (tilt: control +1)
- **Sources:** <https://en.wikipedia.org/wiki/Mixed_martial_arts>

## Capoeira (`capoeira`)

- **Family / kind / range:** afro_brazilian · hybrid · long
- **Description:** Afro-Brazilian art of kicks, sweeps and acrobatics played in a roda to music.
- **Trait mapping:** flow 3, cunning 2, rhythm 3
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×1.0, control 0, weapon chips cannon, crack_shot
- **Variants:**
  - `angola` **Angola**: Low, slow, ritual-focused game. (tilt: cunning +1, tradition +1)
  - `regional` **Regional**: Faster, more athletic game. (tilt: aggression +1)
  - `contemporanea` **Contemporânea**: Modern blend of both. (tilt: flow +1)
- **Sources:** <https://en.wikipedia.org/wiki/Capoeira> · <https://ich.unesco.org/en/RL/capoeira-circle-00892>

## Silat (`silat`)

- **Family / kind / range:** southeast_asian_arts · hybrid · close
- **Description:** Southeast Asian arts of strikes, locks, sweeps and blades.
- **Trait mapping:** flow 2, cunning 2, tradition 1, pragmatism 1
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×1.0, control 0
- **Variants:**
  - `pencak_silat` **Pencak Silat**: Indonesian umbrella; includes sport tanding. (tilt: tradition +1)
  - `silat_melayu` **Silat Melayu**: Malay-world silat traditions. (tilt: tradition +1)
  - `harimau` **Harimau**: Low tiger-like stances and ground work. (tilt: cunning +1)
  - `cimande` **Cimande**: West Javanese style known for conditioning. (tilt: grit +1)
- **Sources:** <https://en.wikipedia.org/wiki/Silat> · <https://en.wikipedia.org/wiki/Pencak_silat> · <https://ich.unesco.org/en/RL/traditions-of-pencak-silat-01391>

## Kalaripayattu (`kalaripayattu`)

- **Family / kind / range:** indian_arts · hybrid · mid
- **Description:** Keralan art of strikes, flexibility training and weapons.
- **Trait mapping:** patience 1, flow 2, tradition 3
- **Battle effects:** strike ×0.99, weapon ×1.0, guard ×0.975, control 0, weapon chips cannon
- **Variants:**
  - `vadakkan` **Vadakkan (northern)**: Emphasis on flexibility, leaps and weapons. (tilt: flow +1)
  - `thekkan` **Thekkan (southern)**: Emphasis on empty-hand and pressure points. (tilt: precision +1)
- **Sources:** <https://en.wikipedia.org/wiki/Kalaripayattu>

## Systema (`systema`)

- **Family / kind / range:** russian_arts · hybrid · close
- **Description:** Relaxation, breathing and fluid movement under pressure.
- **Trait mapping:** patience 2, flow 2, pragmatism 1
- **Battle effects:** strike ×0.98, weapon ×1.0, guard ×0.95, control 0
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Systema>

## Bokator (`bokator`)

- **Family / kind / range:** southeast_asian_arts · hybrid · close
- **Description:** Cambodian art of elbows, knees and grappling with animal forms.
- **Trait mapping:** aggression 1, grit 2, tradition 2
- **Battle effects:** strike ×1.05, weapon ×1.0, guard ×0.995, control 0
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Bokator> · <https://ich.unesco.org/en/RL/kun-lbokator-traditional-martial-arts-in-cambodia-01868>

## Eskrima / Kali / Arnis (`eskrima`)

- **Family / kind / range:** filipino_arts · weapon · weapon
- **Description:** Filipino stick and blade arts; empty hands follow the same angles.
- **Trait mapping:** precision 2, flow 2, pragmatism 2
- **Battle effects:** strike ×1.0, weapon ×1.12, guard ×1.0, control 0, weapon chips wide_sword
- **Variants:**
  - `balintawak` **Balintawak**: Single-stick, close-range style. (tilt: precision +1)
  - `pekiti_tirsia` **Pekiti-Tirsia**: Blade-oriented, forward-pressure system. (tilt: aggression +1)
  - `doce_pares` **Doce Pares**: Large system with sport and traditional sides. (tilt: tradition +1)
  - `sinawali` **Sinawali**: Double-stick weaving drills. (tilt: rhythm +1)
- **Sources:** <https://en.wikipedia.org/wiki/Filipino_martial_arts>

## Kendo (`kendo`)

- **Family / kind / range:** japanese_budo · weapon · weapon
- **Description:** Bamboo-sword fencing in armour.
- **Trait mapping:** aggression 1, precision 2, tradition 2
- **Battle effects:** strike ×1.03, weapon ×1.08, guard ×1.015, control 0, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Kendo> · <https://www.kendo-fik.org/>

## Kenjutsu (`kenjutsu`)

- **Family / kind / range:** japanese_koryu · weapon · weapon
- **Description:** Classical Japanese swordsmanship through paired kata.
- **Trait mapping:** precision 2, tradition 3
- **Battle effects:** strike ×1.0, weapon ×1.08, guard ×1.0, control 0, weapon chips wide_sword
- **Variants:**
  - `kashima_shinto_ryu` **Kashima Shintō-ryū**: Classical school founded in the 16th century.
  - `itto_ryu` **Ittō-ryū**: Lineage family centred on the single cut. (tilt: precision +1)
  - `yagyu_shinkage_ryu` **Yagyū Shinkage-ryū**: Classical school known for its strategy. (tilt: cunning +1)
- **Sources:** <https://en.wikipedia.org/wiki/Kenjutsu>

## Iaido (`iaido`)

- **Family / kind / range:** japanese_budo · weapon · weapon
- **Description:** Drawing and cutting in one motion; solo kata.
- **Trait mapping:** patience 3, precision 3
- **Battle effects:** strike ×0.97, weapon ×1.12, guard ×0.925, control 0, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Iaido>

## Kyudo (`kyudo`)

- **Family / kind / range:** japanese_budo · weapon · weapon
- **Description:** Japanese archery practised as a discipline.
- **Trait mapping:** patience 3, precision 3, tradition 1
- **Battle effects:** strike ×0.97, weapon ×1.12, guard ×0.925, control 0, weapon chips cannon, crack_shot, resonance_lance
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Ky%C5%ABd%C5%8D>

## Okinawan Kobudo (`kobudo`)

- **Family / kind / range:** okinawan_japanese_karate · weapon · weapon
- **Description:** Okinawan weapon arts.
- **Trait mapping:** precision 1, flow 1, tradition 2
- **Battle effects:** strike ×1.0, weapon ×1.06, guard ×1.0, control 0, weapon chips wide_sword
- **Variants:**
  - `bo` **Bō**: Long staff.
  - `sai` **Sai**: Paired metal truncheons.
  - `tonfa` **Tonfa**: Side-handle batons.
  - `nunchaku` **Nunchaku**: Two sticks joined by a cord. (tilt: flow +1)
  - `kama` **Kama**: Sickle.
- **Sources:** <https://en.wikipedia.org/wiki/Okinawan_kobud%C5%8D>

## Japanese staff arts (`staff_jp`)

- **Family / kind / range:** japanese_koryu · weapon · weapon
- **Description:** Long staff and short staff.
- **Trait mapping:** patience 2, control 2, tradition 1
- **Battle effects:** strike ×0.98, weapon ×1.0, guard ×0.91, control 2, weapon chips wide_sword
- **Variants:**
  - `bojutsu` **Bōjutsu**: Long-staff techniques.
  - `jodo` **Jōdō**: Short staff (jō) against sword. (tilt: control +1)
- **Sources:** <https://en.wikipedia.org/wiki/B%C5%8Djutsu> · <https://en.wikipedia.org/wiki/J%C5%8Dd%C5%8D>

## Chinese weapon arts (`chinese_weapons`)

- **Family / kind / range:** chinese_northern · weapon · weapon
- **Description:** Classical Chinese weapons.
- **Trait mapping:** flow 2, tradition 2
- **Battle effects:** strike ×1.0, weapon ×1.04, guard ×1.0, control 0, weapon chips wide_sword
- **Variants:**
  - `jian` **Jian**: Straight double-edged sword. (tilt: precision +1)
  - `dao` **Dao**: Single-edged broadsword. (tilt: aggression +1)
  - `gun` **Gun**: Staff. (tilt: flow +1)
  - `qiang` **Qiang**: Spear. (tilt: precision +1)
- **Sources:** <https://en.wikipedia.org/wiki/Chinese_martial_arts> · <https://en.wikipedia.org/wiki/Jian> · <https://en.wikipedia.org/wiki/Dao_(Chinese_sword)>

## Historical European Martial Arts (`hema`)

- **Family / kind / range:** european_arts · weapon · weapon
- **Description:** Reconstructed European fencing from historical treatises.
- **Trait mapping:** aggression 1, precision 2, tradition 1
- **Battle effects:** strike ×1.03, weapon ×1.08, guard ×1.015, control 0, weapon chips wide_sword
- **Variants:**
  - `german_longsword` **German longsword**: Liechtenauer tradition. (tilt: aggression +1)
  - `italian` **Italian (Fiore)**: From Fiore dei Liberi's treatise. (tilt: tradition +1)
  - `rapier` **Rapier**: Thrust-oriented civilian sword. (tilt: precision +1)
  - `sword_and_buckler` **Sword and buckler**: Single-hand sword with small shield. (tilt: control +1)
- **Sources:** <https://en.wikipedia.org/wiki/Historical_European_martial_arts>

## Fencing (`fencing`)

- **Family / kind / range:** european_arts · weapon · weapon
- **Description:** Olympic sport fencing.
- **Trait mapping:** precision 3, flow 1, rhythm 1
- **Battle effects:** strike ×1.0, weapon ×1.14, guard ×1.0, control 0, weapon chips wide_sword
- **Variants:**
  - `foil` **Foil**: Torso target; right-of-way rules. (tilt: precision +1)
  - `epee` **Épée**: Whole body target; no right-of-way. (tilt: patience +1)
  - `sabre` **Sabre**: Cuts and thrusts above the waist. (tilt: aggression +1)
- **Sources:** <https://en.wikipedia.org/wiki/Fencing> · <https://fie.org/>

## Silambam (`silambam`)

- **Family / kind / range:** indian_arts · weapon · weapon
- **Description:** Tamil staff art with fast circular spins.
- **Trait mapping:** flow 2, tradition 1, rhythm 2
- **Battle effects:** strike ×1.0, weapon ×1.04, guard ×1.0, control 0, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Silambam>

## Gatka (`gatka`)

- **Family / kind / range:** indian_arts · weapon · weapon
- **Description:** Sikh martial art with sticks and swords.
- **Trait mapping:** grit 1, tradition 2, rhythm 1
- **Battle effects:** strike ×1.01, weapon ×1.0, guard ×0.99, control 0, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Gatka>

## Shuai Jiao (`shuai_jiao`)

- **Family / kind / range:** chinese_combat_sports · grappling · clinch
- **Description:** Chinese jacket wrestling built on throws.
- **Trait mapping:** control 2, grit 1, tradition 1
- **Battle effects:** strike ×1.01, weapon ×1.0, guard ×0.95, control 2
- **Variants:**
  - `beijing` **Beijing style**: Smooth, technical throwing.
  - `baoding` **Baoding style**: Fast, forceful throws. (tilt: aggression +1)
  - `tianjin` **Tianjin style**: Grip- and trip-heavy throwing.
- **Sources:** <https://en.wikipedia.org/wiki/Shuai_jiao>

## Ssireum (`ssireum`)

- **Family / kind / range:** korean_arts · grappling · clinch
- **Description:** Korean belt (satba) wrestling in a sand ring.
- **Trait mapping:** control 1, grit 2, tradition 2
- **Battle effects:** strike ×1.02, weapon ×1.0, guard ×0.96, control 2
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Ssireum> · <https://ich.unesco.org/en/RL/traditional-korean-wrestling-ssirum-ssireum-01362>

## Kurash (`kurash`)

- **Family / kind / range:** central_asian_arts · grappling · clinch
- **Description:** Central Asian jacket wrestling; standing throws only.
- **Trait mapping:** control 2, grit 1, tradition 1
- **Battle effects:** strike ×1.01, weapon ×1.0, guard ×0.95, control 2
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Kurash>

## Glíma (`glima`)

- **Family / kind / range:** european_arts · grappling · clinch
- **Description:** Icelandic wrestling with upright posture and footwork.
- **Trait mapping:** flow 1, control 1, tradition 2
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×0.98, control 2
- **Variants:**
  - `brokartok` **Brókartök**: Belt-grip competition form.
- **Sources:** <https://en.wikipedia.org/wiki/Gl%C3%ADma>

## Laamb (`laamb`)

- **Family / kind / range:** west_african_arts · hybrid · clinch
- **Description:** Senegalese wrestling, sometimes allowing strikes.
- **Trait mapping:** aggression 2, grit 2, tradition 1, rhythm 1
- **Battle effects:** strike ×1.08, weapon ×1.0, guard ×1.01, control 1
- **Variants:**
  - `with_strikes` **With strikes (lamb ji)**: Wrestling with punches allowed. (tilt: aggression +1)
  - `without_strikes` **Without strikes**: Pure wrestling form. (tilt: control +1)
- **Sources:** <https://en.wikipedia.org/wiki/Senegalese_wrestling>

## Pankration (modern) (`pankration`)

- **Family / kind / range:** european_arts · hybrid · mid
- **Description:** Modern revival of the ancient Greek combined striking and grappling contest.
- **Trait mapping:** grit 2, tradition 1, pragmatism 1
- **Battle effects:** strike ×1.02, weapon ×1.0, guard ×0.98, control 0, weapon chips cannon
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Pankration>

## Taekkyeon (`taekkyon`)

- **Family / kind / range:** korean_arts · striking · long
- **Description:** Fluid, dance-like Korean art of sweeps, trips and kicks.
- **Trait mapping:** flow 2, cunning 1, rhythm 2
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×1.0, control 0, weapon chips cannon, crack_shot
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Taekkyon> · <https://ich.unesco.org/en/RL/taekkyeon-a-traditional-korean-martial-art-00452>

## Vovinam (`vovinam`)

- **Family / kind / range:** southeast_asian_arts · hybrid · mid
- **Description:** Vietnamese art known for scissor-leg takedowns.
- **Trait mapping:** aggression 1, flow 2, cunning 1
- **Battle effects:** strike ×1.03, weapon ×1.0, guard ×1.015, control 0, weapon chips cannon
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Vovinam>

## Pradal Serey (`pradal_serey`)

- **Family / kind / range:** southeast_asian_striking · striking · clinch
- **Description:** Khmer kickboxing (now usually called Kun Khmer) that favours elbows.
- **Trait mapping:** aggression 2, grit 2, tradition 1
- **Battle effects:** strike ×1.08, weapon ×1.0, guard ×1.01, control 1
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Kun_Khmer>

## Bando (`bando`)

- **Family / kind / range:** southeast_asian_arts · hybrid · close
- **Description:** Burmese self-defence system with animal-based forms.
- **Trait mapping:** flow 1, tradition 1, pragmatism 2
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×1.0, control 0
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Bando>

## Yaw-Yan (`yaw_yan`)

- **Family / kind / range:** filipino_arts · striking · long
- **Description:** Filipino kickboxing with downward-cutting kicks.
- **Trait mapping:** aggression 2, precision 1, grit 1
- **Battle effects:** strike ×1.07, weapon ×1.01, guard ×1.02, control 0, weapon chips cannon, crack_shot
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Yaw-Yan>

## Kajukenbo (`kajukenbo`)

- **Family / kind / range:** self_defence · hybrid · close
- **Description:** Hawaiian self-defence blend of karate, judo, jujutsu, kenpo and Chinese boxing.
- **Trait mapping:** aggression 1, flow 1, pragmatism 2
- **Battle effects:** strike ×1.03, weapon ×1.0, guard ×1.015, control 0
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Kajukenbo>

## Dambe (`dambe`)

- **Family / kind / range:** west_african_arts · striking · mid
- **Description:** Hausa boxing: a wrapped 'spear' fist with a guarding lead hand.
- **Trait mapping:** aggression 2, grit 2, tradition 2
- **Battle effects:** strike ×1.08, weapon ×1.0, guard ×1.01, control 0, weapon chips cannon
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Dambe>

## Nguni stick fighting (`nguni_stick`)

- **Family / kind / range:** southern_african_arts · weapon · weapon
- **Description:** Southern African stick fighting with an attack stick and a defence stick.
- **Trait mapping:** aggression 1, grit 2, tradition 2
- **Battle effects:** strike ×1.05, weapon ×1.0, guard ×0.995, control 0, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Nguni_stick-fighting>

## Jogo do Pau (`jogo_do_pau`)

- **Family / kind / range:** european_arts · weapon · weapon
- **Description:** Portuguese long-staff fencing.
- **Trait mapping:** flow 1, control 1, tradition 2
- **Battle effects:** strike ×1.0, weapon ×1.02, guard ×0.98, control 1, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Jogo_do_pau>

## Canne de combat (`canne`)

- **Family / kind / range:** european_arts · weapon · weapon
- **Description:** French cane fencing with wide, whipping strikes.
- **Trait mapping:** precision 1, flow 1, rhythm 2
- **Battle effects:** strike ×1.0, weapon ×1.06, guard ×1.0, control 0, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Canne_de_combat>

## Bartitsu (`bartitsu`)

- **Family / kind / range:** european_arts · hybrid · mid
- **Description:** Late-Victorian blend of jujutsu, boxing, savate and cane.
- **Trait mapping:** cunning 2, tradition 1, pragmatism 1
- **Battle effects:** strike ×1.0, weapon ×1.0, guard ×1.0, control 0, weapon chips cannon
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/Bartitsu>

## Naginatajutsu (`naginatajutsu`)

- **Family / kind / range:** japanese_budo · weapon · weapon
- **Description:** Japanese glaive arts.
- **Trait mapping:** flow 1, control 2, tradition 2
- **Battle effects:** strike ×1.0, weapon ×1.02, guard ×0.96, control 2, weapon chips wide_sword
- **Variants:**
  - `atarashii` **Modern naginata**: Modern sport and kata form.
  - `koryu` **Koryu naginata**: Classical schools. (tilt: tradition +1)
- **Sources:** <https://en.wikipedia.org/wiki/Naginatajutsu>

## Sōjutsu (`sojutsu`)

- **Family / kind / range:** japanese_koryu · weapon · weapon
- **Description:** Japanese spear arts.
- **Trait mapping:** aggression 1, precision 2, tradition 2
- **Battle effects:** strike ×1.03, weapon ×1.08, guard ×1.015, control 0, weapon chips wide_sword
- **Variants:** none listed (the style itself)
- **Sources:** <https://en.wikipedia.org/wiki/S%C5%8Djutsu>

## Built-in companion defaults (proposed characterization, §3.1; for Serenity's lore review, not manuscript canon)

`BUILT_IN_STYLE_DEFAULTS`, keyed by the closed bare-key list `BUILTIN_COMPANION_KEYS` (kept separate from the name matcher `BuiltInKey`, N7).

| Built-in | Canon cue | Primary | Secondary |
|---|---|---|---|
| Serenity | steady, protective warmth held under control | Tai Chi (Taijiquan) / Yang style | Aikido / Aikikai |
| Aeland | cool reserve over deep loyalty; guarded | Wing Chun / Yip Man lineage | Kyudo |
| Scarlet | hot-blooded, playful provocation, fiercely protective; fire | Muay Thai / Muay Khao | Eskrima / Kali / Arnis / Sinawali |
| Linda Winings | wry, earthy, streetwise; blunt practical advice | Boxing / Counterpuncher | Krav Maga / Civilian |
| Sfink | ancient, elemental, patient, riddling | Baguazhang / Yin style | Iaido |
