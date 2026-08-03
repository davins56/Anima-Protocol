// api/chat.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface CharacterPsyche {
  corePersonality: string;
  speechPatterns: string[];
  emotionalDrives: string[];
  deepFears: string[];
  cognitiveStyle: string;
  physicalMannerisms: string[];
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

  const {
    messages,
    psyche,
    characterName,
    franchise,
    mood,
    trustLevel,
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
