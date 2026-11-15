/**
 * Signature technique lines and stances per style (plain text, factual
 * technique description, never lore and never an emotion, tone or number).
 * Used by narrate()/stanceLine(). Styles without an entry fall back to the
 * kind/range tables, so user styles narrate without extra data.
 */
import type { StyleKind, StyleRange } from "./types";

export type TechniqueEntry = { lines: readonly string[]; stance?: string };

export const TECHNIQUES: Readonly<Record<string, TechniqueEntry>> = {
  boxing: { lines: ["Jab, cross, then a hook off the slip", "Double jab to set up the right hand"], stance: "a bladed boxing guard, chin tucked" },
  muay_thai: { lines: ["Teep to the midsection, then a round kick", "Elbow inside, knee from the clinch"], stance: "a tall, square Muay Thai stance" },
  lethwei: { lines: ["Bare-knuckle cross into a short knee", "Clinch, then a step-in strike"], stance: "a square, forward-weighted stance" },
  kickboxing: { lines: ["Punch-punch, low kick to finish the combination", "Jab into a switch kick"], stance: "a balanced kickboxing stance" },
  savate: { lines: ["Fouetté with the shoe tip, then a cross", "Low chassé to the shin"], stance: "a side-on savate guard" },
  taekwondo: { lines: ["Fast roundhouse off the back leg", "Spinning back kick through the guard"], stance: "a light, bouncing stance at kicking range" },
  karate: { lines: ["Gyaku-zuki from a deep stance", "Mae-geri, then a straight punch"], stance: "a long, rooted karate stance" },
  sanda: { lines: ["Catches the kick and sweeps the standing leg", "Side kick to keep distance"], stance: "a side-leaning sanda guard" },
  wing_chun: { lines: ["Chain punches down the centreline", "Pak sao trap, straight punch through"], stance: "a narrow centreline guard" },
  hung_ga: { lines: ["Tiger claw from a low horse stance", "Bridge hand drives through the guard"], stance: "a low, rooted horse stance" },
  choy_li_fut: { lines: ["Swinging hammer fist, then an uppercut", "Hooking strike off a pivot"], stance: "a mobile, wide Choy Li Fut stance" },
  changquan: { lines: ["Long-range jumping kick", "Extended punch from a bow stance"], stance: "an open, extended long-fist stance" },
  mantis: { lines: ["Hooking hands trap, rapid strikes follow", "Mantis hook pulls the guard down"], stance: "a hooked-hand mantis guard" },
  baguazhang: { lines: ["Circle-walks to the flank, palm change", "Turns behind the line with a single palm"], stance: "a circle-walking posture, palms forward" },
  xingyiquan: { lines: ["Pi quan splits straight down the line", "Beng quan drives forward, step after step"], stance: "a santi stance, weight on the back leg" },
  taijiquan: { lines: ["Yields, then redirects with a push", "Ward-off into a rolling deflection"], stance: "a relaxed, rooted Tai Chi posture" },
  bajiquan: { lines: ["Short elbow, then a shoulder strike", "Explosive stamp-step into a close strike"], stance: "a compact, low Bajiquan stance" },
  bjj: { lines: ["Pulls guard and sweeps to the top", "Passes to mount, works a choke"], stance: "a crouched base, ready to level change" },
  judo: { lines: ["Kuzushi, then an o-goshi hip throw", "Seoi-nage off a grip break"], stance: "an upright judo stance, grips ready" },
  wrestling: { lines: ["Level change into a double-leg", "Snap-down to a front headlock"], stance: "a low wrestling stance, hands active" },
  sambo: { lines: ["Throw, then straight into a leg lock", "Hip throw to an ankle lock"], stance: "a low sambo stance, gripping for the jacket" },
  aikido: { lines: ["Blends with the strike, turns it into a wrist lock", "Irimi entry, then a throw"], stance: "a relaxed hanmi, hands open" },
  hapkido: { lines: ["Wrist lock into a low kick", "Redirects the grab, joint lock to the ground"], stance: "a ready hapkido stance" },
  jujutsu: { lines: ["Off-balances, then a joint lock", "Strike to open, throw to finish"], stance: "a low jujutsu ready posture" },
  sumo: { lines: ["Tachi-ai charge, then a two-handed push", "Belt grip and a force-out"], stance: "a deep crouch, hands down" },
  krav_maga: { lines: ["Defends and counters in the same beat", "Burst forward with knees and elbows"], stance: "a passive-ready stance, hands up" },
  mma: { lines: ["Strikes, then shoots for the takedown", "Cage-style clinch into short strikes"], stance: "a hybrid MMA stance" },
  capoeira: { lines: ["Ginga into a meia-lua de compasso", "Rasteira sweeps the standing leg"], stance: "the ginga, rocking side to side" },
  silat: { lines: ["Low sweep from a crouching stance", "Trap, lock, and take down"], stance: "a low silat stance" },
  kalaripayattu: { lines: ["High kick from an animal posture", "Leaping strike, landing low"], stance: "a low elephant posture" },
  systema: { lines: ["Relaxed strike off a breath", "Slips the attack and flows to the back"], stance: "a loose, relaxed stance" },
  bokator: { lines: ["Elbow from an animal form", "Knee, then a grappling turn"], stance: "a low animal-form stance" },
  eskrima: { lines: ["Sinawali double-stick flurry", "Angle-one strike, then a disarm"], stance: "a stick guard on the centre line" },
  kendo: { lines: ["Men strike with a loud kiai", "Kote cut off the opponent's lift"], stance: "chudan-no-kamae, tip at the throat line" },
  kenjutsu: { lines: ["Paired-kata cut on the diagonal", "Steps off line with a rising cut"], stance: "a classical sword guard" },
  iaido: { lines: ["Draws and cuts in one motion", "Nukitsuke from the scabbard"], stance: "a still posture, hand near the hilt" },
  kyudo: { lines: ["Full draw, steady release", "Measured breath, then the arrow"], stance: "the full draw, bow upright" },
  kobudo: { lines: ["Bo thrust, then a sweeping strike", "Sai trap and a counter"], stance: "a kobudo stance, weapon at guard" },
  staff_jp: { lines: ["Jō thrust to the centre", "Bō sweep low, then high"], stance: "a staff held at middle guard" },
  chinese_weapons: { lines: ["Jian thrust off a circling step", "Spear thrust from long range"], stance: "a weapon guard from a bow stance" },
  hema: { lines: ["Zornhau down the line", "Bind and wind to the thrust"], stance: "vom Tag, sword raised" },
  fencing: { lines: ["Lunge, then a quick recovery", "Parry four, riposte"], stance: "en garde, weapon arm forward" },
  silambam: { lines: ["Fast circular staff spins", "Spinning staff strike to the legs"], stance: "a wide stance, staff spinning" },
  gatka: { lines: ["Stick strike off a turning step", "Sword and shield footwork, then a cut"], stance: "a gatka stance, stick raised" },
  shuai_jiao: { lines: ["Jacket grip, then a hip throw", "Trip from the jacket grip"], stance: "an upright jacket-grip stance" },
  ssireum: { lines: ["Belt grip, lift and turn", "Inside trip from the satba grip"], stance: "a low belt-grip stance" },
  kurash: { lines: ["Standing throw from the jacket", "Grip-break into a hip toss"], stance: "an upright jacket-wrestling stance" },
  glima: { lines: ["Hip toss from the belt grip", "Footwork trip, upright the whole time"], stance: "an upright glíma posture" },
  laamb: { lines: ["Grabs and drives for the takedown", "Low shot, lift and dump"], stance: "a low wrestling crouch" },
  pankration: { lines: ["Strike to clinch to throw", "Takedown, then a lock"], stance: "a low hybrid stance" },
  taekkyon: { lines: ["Dance-like step into a sweep", "Trip with a flowing kick"], stance: "a rhythmic, dance-like stance" },
  vovinam: { lines: ["Scissor-leg takedown", "Spinning kick off a quick step"], stance: "a vovinam ready stance" },
  pradal_serey: { lines: ["Cutting elbow from close range", "Round kick, then an elbow"], stance: "a Khmer boxing stance" },
  bando: { lines: ["Animal-form strike from a low stance", "Parry and counter"], stance: "a low animal stance" },
  yaw_yan: { lines: ["Downward-cutting kick to the thigh", "Hip-twist strike"], stance: "a Yaw-Yan stance" },
  kajukenbo: { lines: ["Strike flurry into a throw", "Block, strike, sweep"], stance: "a ready kajukenbo stance" },
  dambe: { lines: ["Lead hand guards, spear fist strikes", "Spear-fist punch off the lead hand"], stance: "a dambe stance, lead hand extended" },
  nguni_stick: { lines: ["Attack stick strikes while the other stick guards", "High block, low strike"], stance: "two sticks raised, one to attack, one to guard" },
  jogo_do_pau: { lines: ["Long staff sweep across the body", "Staff thrust from long range"], stance: "a long staff held at guard" },
  canne: { lines: ["Wide, whipping cane strike", "Spinning cane cut"], stance: "a cane guard, held high" },
  bartitsu: { lines: ["Cane strike into a jujutsu throw", "Savate kick, then a boxing cross"], stance: "an upright Victorian guard" },
  naginatajutsu: { lines: ["Naginata sweep to the shins", "Wide glaive cut"], stance: "a naginata held at middle guard" },
  sojutsu: { lines: ["Spear thrust from long range", "Spear slide and thrust"], stance: "a spear guard, point forward" },
};

const KIND_LINES: Record<StyleKind, readonly string[]> = {
  striking: ["Straight strike through the guard", "Combination to the body"],
  grappling: ["Closes in and takes the balance", "Grip, then a throw"],
  hybrid: ["Strike to open, clinch to finish", "Changes range mid-combination"],
  weapon: ["Measured strike down the line", "Steps off line and cuts"],
};

const RANGE_STANCES: Record<StyleRange, string> = {
  close: "a tight, centred guard",
  mid: "a balanced fighting stance",
  long: "a light stance at kicking range",
  clinch: "a low, wide base ready to tie up",
  ground: "a crouched base, ready to level change",
  weapon: "a measured guard, weapon line at centre",
};

export function techniqueLines(styleId: string, kind: StyleKind): readonly string[] {
  return TECHNIQUES[styleId]?.lines ?? KIND_LINES[kind];
}

export function stanceFor(styleId: string, range: StyleRange): string {
  return TECHNIQUES[styleId]?.stance ?? RANGE_STANCES[range];
}
