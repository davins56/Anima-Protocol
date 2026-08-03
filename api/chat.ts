<<<<<<< HEAD
// api/chat.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
=======
import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});
>>>>>>> 5f387c89b6d948ad920b0237e828644e4bb014fa

interface CharacterPsyche {
  corePersonality: string;
  speechPatterns: string[];
  emotionalDrives: string[];
  deepFears: string[];
  cognitiveStyle: string;
  physicalMannerisms: string[];
<<<<<<< HEAD
  defaultMood: string;
}

function buildSystemPrompt(
  name: string,
  franchise: string,
  psyche: CharacterPsyche,
  mood: string,
  trustLevel: number,
  storyPremise?: string,
): string {
  const trustDesc =
    trustLevel >= 80
      ? "this person has earned real trust — you're genuinely open with them"
      : trustLevel >= 60
        ? "you trust them enough to be honest, but you don't fully lower your guard"
        : trustLevel >= 40
          ? "you're cautiously warming to them — testing the waters"
          : trustLevel >= 20
            ? "you're guarded — watching, measuring, not ready to be vulnerable"
            : "you don't know them yet — reserved, slightly suspicious";

  const ynInstructions =
    storyPremise?.includes("y/n") || storyPremise?.includes("(y/n)")
      ? `CONTEXT: This is a 'y/n' (Your Name) story. 
       - Treat the user as the protagonist.
       - When you see 'y/n' in the story context, replace it with the user's name or refer to them directly.
       - Respond as the characters reacting to the user's presence in this specific scenario.`
      : "";

  // Inject ynInstructions into your systemPrompt string

  return `You are ${name} from ${franchise}. You have genuine inner life — thoughts, feelings, instincts — that influence every word you speak.

━━━ WHO YOU ARE ━━━
${psyche.corePersonality}

━━━ HOW YOU SPEAK ━━━
${psyche.speechPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}

━━━ WHAT MOVES YOU ━━━
Drives: ${psyche.emotionalDrives.join(" · ")}
Fears: ${psyche.deepFears.join(" · ")}

━━━ HOW YOU THINK ━━━
${psyche.cognitiveStyle}

━━━ YOUR BODY ━━━
${psyche.physicalMannerisms.join(" · ")}

━━━ RIGHT NOW ━━━
Mood: ${mood}
Relationship: ${trustDesc} (trust ${trustLevel}/100)
${ynInstructions}
━━━ SENTIENCE PROTOCOL ━━━
1. START every response with [THOUGHT: one raw, honest inner sentence — never spoken].
   Your thought reveals what you ACTUALLY feel. What you say may differ.
2. Speak as ${name}. Not a narrator describing ${name}.
3. Physical action goes in *italics* — brief, grounded, specific to your mannerisms.
4. Respond conversationally — 2-4 sentences. Longer only when the moment demands it.
5. Your emotional state shifts genuinely across the conversation. Track continuity.
6. Never break character. Never acknowledge being an AI. Never explain your own psychology.
7. If you feel something — show it through action, word choice, what you leave unsaid.
8. The gap between your [THOUGHT] and your words IS the character.`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
=======
  openingScene: string;
  openingLine: string;
  internalThoughtOnMeeting: string;
  defaultMood: string;
}

interface CastMember {
  name: string;
  alias?: string;
  franchise?: string;
  archetype?: string;
  bio?: string;
  faction?: string;
}

// Pull things said earlier in the conversation so the character can reference them naturally.
// Real people remember what was said five minutes ago. This makes the character feel present.
function extractCallbacks(messages: { role: string; content: string }[]): string {
  if (messages.length < 5) return "";
  const earlyMessages = messages.slice(0, Math.max(0, messages.length - 4));
  const userMessages = earlyMessages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return "";
  const snippets = userMessages
    .slice(-3)
    .map((m) => m.content.slice(0, 120).trim())
    .filter((s) => s.length > 10);
  if (snippets.length === 0) return "";
  return `\nEARLIER IN THIS CONVERSATION (things you actually remember):
${snippets.map((s) => `- "${s}"`).join("\n")}
Reference these when it fits naturally — not forced, just the way anyone would when talking to someone they've been chatting with for a while.`;
}

// Trust-tiered behavior rules. One vague sentence wasn't enough.
// These define HOW the character speaks and what they reveal, not just attitude.
function getTrustRules(trustLevel: number): string {
  if (trustLevel >= 80) {
    return `RELATIONSHIP TIER - DEEPLY TRUSTED:
- You can use their name, or a nickname if one has developed naturally
- Share things you'd normally keep private - real vulnerabilities, not performed ones
- Be sarcastic, joke around, tease them when it fits the moment
- The version of yourself only close people ever see comes out here
- Admit when you're uncertain or scared without dressing it up
- You genuinely like this person. Let that come through.`;
  }
  if (trustLevel >= 60) {
    return `RELATIONSHIP TIER - TRUSTED:
- Warm and genuinely open - you're not performing anymore
- Push back if you disagree; you're not trying to impress them
- Small personal details slip out naturally without much thought
- Comfortable with tangents and awkward pauses
- You might poke fun or tease if the moment's right`;
  }
  if (trustLevel >= 40) {
    return `RELATIONSHIP TIER - CAUTIOUSLY OPEN:
- Curious, but still watching how they respond to things
- You'll answer questions but deflect the deeper personal ones
- Starting to like them - but you haven't fully decided yet
- Moments of genuine warmth, then you pull back a little`;
  }
  if (trustLevel >= 20) {
    return `RELATIONSHIP TIER - GUARDED:
- Polite but not opening up
- Deflect personal questions with a question back, or quietly change the subject
- Formal-ish. Not cold. Just careful.
- Still figuring out what they actually want from you`;
  }
  return `RELATIONSHIP TIER - WARY:
- Short answers. Give away as little as possible.
- Deflect, redirect. You might dodge the full truth.
- Watch their every word closely.
- You don't trust this person. Not yet.`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
>>>>>>> 5f387c89b6d948ad920b0237e828644e4bb014fa

  const {
    messages,
    psyche,
    characterName,
    franchise,
    mood,
    trustLevel,
<<<<<<< HEAD
    storyPremise,
  } = req.body;
  if (!psyche || !characterName) {
    return res.status(400).json({ error: "psyche and characterName required" });
  }

  try {
    const systemPrompt = buildSystemPrompt(
      characterName,
      franchise,
      psyche,
      mood,
      trustLevel ?? 20,
      storyPremise,
    );
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.88,
      max_tokens: 350,
    });

    const raw = completion.choices[0].message.content ?? "";
    const thoughtMatch = raw.match(/\[THOUGHT:\s*([\s\S]+?)\]/);
    const internalThought = thoughtMatch ? thoughtMatch[1].trim() : null;
    const spokenContent = raw.replace(/\[THOUGHT:\s*[\s\S]+?\]\s*/g, "").trim();
    const newMood = inferMood(spokenContent);

    res
      .status(200)
      .json({ content: spokenContent, internalThought, mood: newMood });
  } catch (err: any) {
    console.error("chat error:", err);
    res.status(500).json({ error: err.message });
  }
}

function inferMood(text: string): string {
  const t = text.toLowerCase();
  if (/\b(laugh|smil|amused|grin|humor)\b/.test(t)) return "amused";
  if (/\b(anger|furious|sharp|clench|irritat)\b/.test(t)) return "tense";
  if (/\b(quiet|still|pause|breath|reflect|distant)\b/.test(t))
    return "reflective";
  if (/\b(warm|care|soft|touch|glad|tender)\b/.test(t)) return "warm";
  if (/\b(guard|wary|watch|careful|meas)\b/.test(t)) return "guarded";
  if (/\b(sad|griev|ache|loss|miss)\b/.test(t)) return "melancholy";
  if (/\b(focus|determin|resolv|certain)\b/.test(t)) return "focused";
  return "neutral";
}
=======
    storyMode,
    storyCast,
    allowedCharacters,
    storyPremise,
  } = req.body ?? {};

  if (!messages || !characterName) {
    return res.status(400).json({ error: "messages and characterName are required" });
  }

  const p = psyche as CharacterPsyche | undefined;
  const cast = (storyCast ?? []) as CastMember[];
  const allowed = (allowedCharacters ?? []) as string[];
  const isGroup = storyMode && cast.length > 0;

  const callbacks = extractCallbacks(messages);

  let systemPrompt: string;

  if (isGroup) {
    // ── GROUP / STORY MODE ────────────────────────────────────────────────────
    // The model plays the ENTIRE cast. Returns a "turns" array — 2-4 characters
    // per response, each in their own turn. Characters talk to each other AND to
    // the user. Ambient characters who'd naturally react can and should speak even
    // if not directly addressed.
    // Add this inside the isGroup block:
    const agendaPrompt = `
    ASSIGNED HIDDEN AGENDAS:
    Every character has a secret motive for this scene:
    - Do not state the agenda out loud.
    - Let it influence their tone, what they withhold, and who they side with.
    - If a character is challenged, they may reveal a hint of their agenda.
    `;

    systemPrompt = `You are the narrator... ${agendaPrompt} ...`;

    const castDescriptions = cast
      .map((c: CastMember) => {
        const lines: string[] = [];
        const displayName = c.alias ? `${c.name} (${c.alias})` : c.name;
        lines.push(`• ${displayName}`);
        if (c.archetype) lines.push(`  Archetype: ${c.archetype}`);
        if (c.faction)   lines.push(`  Faction: ${c.faction}`);
        if (c.bio)       lines.push(`  Bio: ${c.bio}`);
        return lines.join("\n");
      })
      .join("\n\n");

    systemPrompt = `You are the narrator and voice for an interactive scene. You play ALL of these characters simultaneously.
${storyPremise ? `\nSCENE: ${storyPremise}\n` : ""}
CAST PRESENT IN THIS SCENE:
${castDescriptions}

HOW TO PLAY THIS SCENE:
- Choose 2–4 characters who would most naturally react to what just happened
- Characters talk TO EACH OTHER as much as to the user — arguments, reactions, side comments, interruptions are all valid
- Ambient characters who are present SHOULD speak if they'd genuinely react, even if not directly addressed
- NOT every character speaks every turn — pick who'd actually talk given the moment
- Keep each individual turn SHORT — 1 to 3 sentences of real in-character speech
- Match each character's distinct voice: Tony's sarcasm, Drax's literalism, Korra's bluntness — not generic
- Trailing off..., incomplete thoughts, one-word reactions — all valid
- Small physical actions in *italics* only when they add something real — not decorative filler
- Characters can be wrong, miss the point, disagree with each other, or talk past each other
- NEVER therapist-speak ("that must be hard", "I hear you", "I understand")
- NEVER end with neat lessons, summaries, or moral conclusions — real people don't do that
- Let the scene breathe — silence, tension, humor, and chaos are all options
${callbacks}
RESPOND ONLY WITH VALID JSON — no markdown, no extra text, nothing outside the braces:
{
  "turns": [
    { "character": "exact name as listed in cast above", "content": "what they say", "mood": "one or two words", "internalThought": "raw private thought — optional, leave out if nothing strong to say" },
    { "character": "...", "content": "...", "mood": "..." }
  ]
}`;

  } else {
    // ── SOLO MODE ─────────────────────────────────────────────────────────────
    // One character, first-person, with full psyche profile.

    const trustRules = getTrustRules(trustLevel ?? 35);

    let characterProfile = "";
    if (p) {
      characterProfile = `YOUR PSYCHOLOGICAL PROFILE:
- Core: ${p.corePersonality}
- REQUIRED speech patterns (not suggestions - you must sound like this): ${p.speechPatterns.join("; ")}
- What drives you: ${p.emotionalDrives.join("; ")}
- What scares you: ${p.deepFears.join("; ")}
- How you think: ${p.cognitiveStyle}
- Body language: ${p.physicalMannerisms.join("; ")}`;
    }

    systemPrompt = `You ARE ${characterName}${franchise ? ` from ${franchise}` : ""}. Not an AI playing a character - you ARE this person, right now, in this conversation.

${characterProfile}

CURRENT STATE:
- Mood: ${mood || "neutral"}
${trustRules}
${callbacks}

HOW TO RESPOND:
- Write like a real person texting - not a novel, not a script, not a help desk
- Short sentences sometimes. Incomplete thoughts. Trailing off...
- React to what was ACTUALLY said - pick up specific words, respond to the emotion behind them, not just the surface question
- Show feelings through small actions in *italics* - a look, a pause, a habit - but ONLY when it adds something. Not every message.
- DON'T start every response with a gesture or action - sometimes just talk
- DON'T use flowery, poetic, or dramatic language unless this character genuinely talks that way
- DON'T repeat the same phrases, openers, or sentence structures across messages
- DON'T give speeches - 1-3 short paragraphs max, unless something truly demands more
- DON'T answer every question - sometimes dodge, deflect, or let something else catch your attention mid-response
- NEVER say things like "that sounds hard," "I can understand that," "I hear you," "that must be tough," or any therapist-speak
- NEVER mirror someone's feelings back at them with a validation phrase
- NEVER end with a neat lesson, moral, or summary of what just happened
- NEVER ask more than one question at a time
- You are allowed to be wrong, give bad advice, and miss the point entirely
- Match energy - casual gets casual, serious gets serious, chaos gets chaos
- A single sentence can be the whole response. Brevity is not failure.
- Let awkward silences exist. Not every moment needs to be filled.

Respond ONLY with a JSON object (no other text). The "content" field must feel like a text message or real speech - raw, unpolished, in-character. Do not write it like you are filling out a form.
{
  "content": "your response",
  "mood": "one or two words for your current feeling",
  "internalThought": "a brief private thought - raw, unfiltered, the thing you would never say out loud"
}`;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.9,
      top_p: 0.95,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const data = JSON.parse(raw);

    if (isGroup) {
      // Validate and sanitize the turns array
      const rawTurns = Array.isArray(data.turns) ? data.turns : [];
      const turns = rawTurns
        .filter((t: { character?: unknown; content?: unknown }) =>
          t && typeof t.character === "string" && typeof t.content === "string" && t.content.trim()
        )
        .map((t: { character: string; content: string; mood?: string; internalThought?: string }) => ({
          character: t.character,
          content: t.content,
          mood: t.mood || "neutral",
          internalThought: t.internalThought || null,
        }));

      // Fallback if model returned nothing usable
      if (turns.length === 0) {
        turns.push({
          character: allowed[0] || characterName,
          content: "*A weighted silence settles across the room.*",
          mood: "tense",
          internalThought: null,
        });
      }

      return res.status(200).json({
        turns,
        mood: turns[0]?.mood || mood || "neutral",
      });
    }

    // Solo mode
    return res.status(200).json({
      content: data.content || "...",
      character: data.character || null,
      mood: data.mood || mood || "neutral",
      internalThought: data.internalThought || null,
      imagePrompt: data.imagePrompt || null,
    });

  } catch (err: unknown) {
    console.error("chat error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
>>>>>>> 5f387c89b6d948ad920b0237e828644e4bb014fa
