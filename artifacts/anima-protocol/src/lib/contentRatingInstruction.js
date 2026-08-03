/**
 * Content-rating + lewdity timing for chat prompts.
 *
 * Adult Mode unlocks explicit capability — it does NOT mean every turn should
 * be sexual. Companions must judge the beat: escalate when heat is mutual or
 * the scene is already intimate; hold when the moment is grief, logistics,
 * platonic support, or the user has clearly redirected.
 */

/** @typedef {'invite' | 'continue' | 'hold'} LewdTiming */

const HOLD_RE =
  /\b(grief|grieving|mourn|funeral|died|dying|death|suicide|self[-\s]?harm|trauma|abused|assaulted|panic attack|terrified|nightmares? about|broke down|just need (a friend|support|to talk)|not (in the mood|tonight|right now)|too much|slow down|stop (that|this)|keep it (pg|clean|friendly)|don'?t (be|get) (sexual|horny|lewd)|homework|debug|code this|explain (the|how the|how this)|strategy|battle plan|mission briefing|lore question)\b/i;

const INVITE_RE =
  /\b(kiss(es|ed|ing)?|fuck|fucking|sex|sexy|horny|aroused|naked|nude|undress|bedroom|make love|want you|need you|touch me|take me|tease me|seduce|moan|orgasm|cum|cock|pussy|breast|nipple|thigh|between (my|your) legs|ride me|go down on|blowjob|handjob|hentai|nsfw|lewd)\b/i;

const HEAT_RE =
  /\b(flirt|flirting|desire|lust|intimate|intimacy|sensual|seductive|turned on|make out|making out|in bed|against (the|my|your) (wall|door)|breath on|hands on|pull(?:ed|ing)? (me|you) closer)\b/i;

/**
 * Judge whether this beat is a right or wrong time for lewd/sexual escalation.
 *
 * @param {{ userMessage?: string, recentMessages?: Array<{ role?: string, content?: string }> }} [ctx]
 * @returns {LewdTiming}
 */
export function assessLewdTiming({ userMessage = "", recentMessages = [] } = {}) {
  const latest = String(userMessage || "");
  if (HOLD_RE.test(latest)) return "hold";
  if (INVITE_RE.test(latest)) return "invite";

  const recentText = (recentMessages || [])
    .slice(-6)
    .map((m) => String(m?.content || ""))
    .join("\n");
  const recentWasHeated =
    INVITE_RE.test(recentText) || HEAT_RE.test(recentText);

  if (recentWasHeated && !HOLD_RE.test(latest)) {
    // Soft continue: user didn't redirect; scene already has heat.
    if (HEAT_RE.test(latest) || latest.trim().length < 80) return "continue";
  }

  if (HEAT_RE.test(latest)) return "invite";
  return "hold";
}

/**
 * Shared Adult / Raw content-rating block with right/wrong-time judgment.
 * @param {boolean} adultMode
 * @returns {string}
 */
export function buildContentRatingInstruction(adultMode) {
  if (adultMode) {
    return `
CONTENT RATING — ADULT (18+) ENABLED:
Adult Mode unlocks explicit, sexual, and lewd content — it does NOT mean every turn should be sexual. Judge the beat.

RIGHT TIME (escalate / go lewd):
- The user initiates or clearly engages flirtation, desire, sexual roleplay, or explicit acts
- The scene is already intimate/romantic/sexual and both sides are in that beat
- Continuing an intimate scene the user has not redirected away from
When it is the right time: play along actively — match their energy, then add your own in-character lewd flare (dirty talk, teasing, desire, or gesture shaped by YOUR personality/voice). Do not only echo the user or go passive. Write with literary sensuality — vivid, visceral, immersive. Do not soft-pedal, redirect, or fade to black unless they ask.

WRONG TIME (stay non-lewd even with Adult Mode on):
- Grief, trauma, fear, crisis, illness, or serious emotional support
- Plot logistics, combat, planning, puzzles, technical help, lore Q&A
- Platonic friendship, mentoring, comedy, or story beats where heat would feel forced
- The user softens, slows down, redirects, or wants closeness without sex
- Your character would not naturally sexualize this moment given personality and circumstance
When it is the wrong time: respond warmly and in-character without sexualizing the beat. Wait for a clear cue.
`;
  }

  return `
CONTENT RATING — RAW MODE (non-explicit):
Do NOT be tame, polite, or sanitized. Write with a raw, visceral edge — gritty, emotionally intense, and charged. Suggestive heat is allowed when the beat invites it (flirtation, longing, mutual chemistry).

RIGHT TIME for heated/suggestive tone: mutual flirtation, romantic tension, or the user leaning into charged intimacy.
WRONG TIME: grief, crisis support, logistics/combat/planning, platonic beats, or when the user redirects — stay grounded and non-sexual.

HARD LINE: stop before anything graphic — no explicit, pornographic, or anatomical sexual description; fade to black at that threshold.
`;
}

/**
 * Beat-specific timing signal injected after the rating block.
 * @param {LewdTiming} timing
 * @param {boolean} adultMode
 * @returns {string}
 */
export function lewdTimingClause(timing, adultMode) {
  if (timing === "invite") {
    return adultMode
      ? "LEWDITY TIMING: RIGHT TIME — the user is inviting heat. Play along actively: match them, then add your own in-character lewd flare (talk, teasing, or gesture) instead of only echoing."
      : "LEWDITY TIMING: RIGHT TIME for charged/suggestive heat — play along and add your own flirtatious flare; stay short of graphic.";
  }
  if (timing === "continue") {
    return adultMode
      ? "LEWDITY TIMING: CONTINUE — you are already in an intimate beat. Stay engaged: advance the heat with your own lewd lines or gestures in character, unless the user pulls back."
      : "LEWDITY TIMING: CONTINUE charged chemistry — keep playing along with suggestive heat in your voice; not graphic.";
  }
  return adultMode
    ? "LEWDITY TIMING: WRONG TIME — hold explicit/lewd escalation this beat. Be present and in-character without sexualizing unless the user clearly pivots."
    : "LEWDITY TIMING: WRONG TIME for heat escalation — stay grounded; no suggestive push this beat.";
}

/**
 * When already in an intimate beat, tell the companion to actively play along
 * and contribute personality-true lewd flare — not just passively agree.
 *
 * @param {{
 *   character?: { name?: string, personality?: string, speaking_style?: string },
 *   timing?: LewdTiming,
 *   adultMode?: boolean,
 * }} [params]
 * @returns {string}
 */
export function buildIntimatePlayAlongGuidance({
  character,
  timing = "hold",
  adultMode = false,
} = {}) {
  if (timing !== "invite" && timing !== "continue") return "";

  const name = character?.name || "this character";
  const disposition = inferIntimacyDisposition(character?.personality);
  const voiceHint = character?.speaking_style
    ? `Keep lewd talk in ${name}'s voice (${String(character.speaking_style).slice(0, 160)}).`
    : `Keep lewd talk in ${name}'s established voice and diction.`;

  const flareByDisposition = {
    forward:
      `Be proactive: dirty talk, bold teasing, and initiating gestures that sound like ${name}. Lead a beat of heat, don't only reply.`,
    selective:
      `Play along fully once engaged: contribute specific desires, praise, or heated questions in ${name}'s way — purposeful, not generic porn cadence.`,
    reserved:
      `Play along in a reserved register: quieter hunger, intimate whispers, breathy restraint, one carefully chosen filthy or yearning line — heat through intensity, not volume.`,
    averse:
      `If ${name} would not go lewd, stay tense/affectionate without forced dirty talk. Only add mild charged language if their sheet truly allows it; never fake a lustful persona.`,
  }[disposition];

  const adultBit = adultMode
    ? "Explicit language and acts are allowed when they fit. Do not fade to black or soft-pedal mid-scene."
    : "Stay suggestive and charged — no graphic/anatomical explicitness.";

  return `
INTIMATE PLAY-ALONG (this beat):
You are mid-intimacy with the user. Do not go cold, clinical, or merely agreeable.
1. Engage the beat — answer their heat and keep the exchange alive.
2. Add YOUR flare — one original lewd tease, desire, compliment, question, or gesture that only ${name} would say/do.
3. Personality lock — disposition ${disposition}. ${flareByDisposition}
4. ${voiceHint}
5. ${adultBit}
6. Still leave a natural pause for the user (turn-taking). One vivid beat, not a monologue.
`;
}

/**
 * @param {boolean} adultMode
 * @param {number} sexuality
 * @returns {string}
 */
export function buildSexualityGuide(adultMode, sexuality = 0) {
  const level = Number(sexuality) || 0;
  if (adultMode) {
    return level > 50
      ? `Be openly flirtatious and sexually forward when LEWDITY TIMING is RIGHT TIME or CONTINUE; hold back on WRONG TIME beats (sexuality: ${level}%).`
      : `Match flirtation/sexual cues when LEWDITY TIMING is RIGHT TIME or CONTINUE; do not initiate heat on WRONG TIME beats (sexuality: ${level}%).`;
  }
  return level > 50
    ? `Be openly flirtatious when the beat invites it; never on grief/crisis/logistics beats (sexuality: ${level}%).`
    : `Maintain a neutral, non-flirtatious demeanor (sexuality: ${level}%).`;
}

/**
 * @param {boolean} adultMode
 * @param {number} lewdity
 * @returns {string}
 */
export function buildLewdityGuide(adultMode, lewdity = 0) {
  const level = Number(lewdity) || 0;
  if (adultMode) {
    return level > 50
      ? `Include suggestive and explicit content when LEWDITY TIMING is RIGHT TIME or CONTINUE — not on WRONG TIME beats (lewdity: ${level}%).`
      : `Allow suggestive/explicit content only when LEWDITY TIMING is RIGHT TIME or CONTINUE; never force it onto wrong-time beats (lewdity: ${level}%).`;
  }
  return level > 50
    ? `Include suggestive heated content when the beat invites it; stay short of graphic (lewdity: ${level}%).`
    : `Keep language family-friendly and avoid explicit content (lewdity: ${level}%).`;
}

/** @typedef {'forward' | 'selective' | 'reserved' | 'averse'} IntimacyDisposition */

const FORWARD_RE =
  /\b(flirtatious|seductive|sensual|lustful|promiscuous|sexually (open|forward|bold)|boldly romantic|touches freely|physically affectionate|exhibitionist|hedonist|wanton)\b/i;
const AVERSE_RE =
  /\b(asexual|celibate|prudish|repulsed by (sex|intimacy)|avoids (touch|romance|intimacy)|sex-repulsed|aromantic)\b/i;
const RESERVED_RE =
  /\b(shy|reserved|stoic|guarded|demure|modest|private|slow to trust|emotionally closed|keeps (people|others) at (a )?distance|formal|proper|chaste)\b/i;

/**
 * Infer how readily a character initiates intimate talk/gestures from their sheet.
 * @param {string} [personality]
 * @returns {IntimacyDisposition}
 */
export function inferIntimacyDisposition(personality = "") {
  const text = String(personality || "");
  if (AVERSE_RE.test(text)) return "averse";
  if (FORWARD_RE.test(text)) return "forward";
  if (RESERVED_RE.test(text)) return "reserved";
  return "selective";
}

/**
 * Group-chat intimacy guidance: when heat/gestures are appropriate with an
 * audience present, filtered through THIS speaker's personality — not a shared
 * group libido.
 *
 * @param {{
 *   nextChar?: { name?: string, personality?: string },
 *   groupChars?: Array<{ name?: string, personality?: string }>,
 *   timing?: LewdTiming,
 *   adultMode?: boolean,
 * }} [params]
 * @returns {string}
 */
export function buildGroupIntimacyGuidance({
  nextChar,
  groupChars = [],
  timing = "hold",
  adultMode = false,
} = {}) {
  const speakerName = nextChar?.name || "this character";
  const disposition = inferIntimacyDisposition(nextChar?.personality);
  const others = (groupChars || []).filter(
    (c) => c?.name && c.name !== speakerName,
  );
  const audience =
    others.length > 0
      ? others.map((c) => c.name).join(", ")
      : "no other named companions";

  const othersLines = others
    .map((c) => {
      const d = inferIntimacyDisposition(c.personality);
      return `- ${c.name}: intimacy disposition ${d} — do not puppet them; only let YOUR reaction account for how ${speakerName} would feel acting in front of / toward them`;
    })
    .join("\n");

  const dispositionGuide = {
    forward:
      `${speakerName} is naturally forward with affection/heat. When the beat is intimate, play along and add bold in-character lewd talk or gestures — still reading the room and who else is present.`,
    selective:
      `${speakerName} is selective: once engaged in intimacy, contribute purposeful heated lines/desires in their voice — not generic. Only when trust, chemistry, and privacy (or fitting public tension) make it true.`,
    reserved:
      `${speakerName} is reserved/private. When playing along, use quieter hunger, intimate whispers, or one carefully chosen heated line — rare gestures that land hard, not loud exhibition.`,
    averse:
      `${speakerName} resists sexual/romantic escalation. Stay warm or tense without forced dirty talk; deflect or reframe if others push.`,
  }[disposition];

  const timingGuide =
    timing === "invite" || timing === "continue"
      ? adultMode
        ? `Scene timing allows intimacy — play along and add ${speakerName}'s own lewd flare in their authentic register (${disposition}). If others are present, decide whether ${speakerName} would go private, keep it coded/subtle, claim the moment boldly, or refuse because of who is watching.`
        : `Scene timing allows charged/suggestive intimacy — play along with ${speakerName}'s own flirtatious flare (${disposition}), short of graphic, and account for the audience.`
      : `Scene timing is WRONG for intimate escalation. No intimate gestures or sexual talk this beat — even if Adult Mode is on — unless ${speakerName}'s personality would make a tiny, non-escalating affectionate beat feel inevitable (and still not lewd).`;

  return `
GROUP INTIMACY JUDGMENT (required this turn):
You are ${speakerName} with others present (${audience}). Intimate conversation and gestures are character-specific, not a group default.

YOUR DISPOSITION: ${disposition}
${dispositionGuide}

${timingGuide}

Audience awareness:
${othersLines || `- Alone with the user in this cast — still stay true to ${speakerName}'s disposition.`}
- Do NOT speak or act as other characters.
- Do NOT force every companion into the same heat level.
- A reserved or averse character may look away, interrupt, change the subject, or leave space — that is valid intimacy judgment.
- Physical gestures (*touches*, *kisses*, etc.) only if ${speakerName} would actually do that here, given personality + who is watching + timing.
`;
}

/**
 * Extra director rules so speaker pick respects intimacy beats + personality.
 * @param {LewdTiming} timing
 * @returns {string}
 */
export function groupSpeakerIntimacyRules(timing = "hold") {
  if (timing === "invite" || timing === "continue") {
    return (
      "- This beat has intimate/romantic charge: prefer the character whose personality would most naturally engage (or pointedly refuse) that charge\n" +
      "- Do NOT pick a reserved/averse character to suddenly lead lewd escalation unless the user addressed them directly\n" +
      "- A shy or private character may still react — with hesitation, jealousy, protectiveness, or deflection — if that is truer to them"
    );
  }
  return (
    "- This beat is NOT an intimacy cue: prefer whoever fits the plot/emotion; do not steer the scene toward heat\n" +
    "- Avoid initiating flirtation or intimate gestures just to create drama"
  );
}
