import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
declare const process: { env: Record<string, string | undefined> };

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// World-grounding per franchise. Characters shouldn't exist in a vacuum.
// Tony Stark knows the Battle of New York happened. Korra knows Republic City.
// Even a single paragraph of world context anchors speech patterns and fears correctly.
const franchiseContexts: Record<string, string> = {
  "Avengers":
    "The Marvel Cinematic Universe. Key events this character carries: Battle of New York (Loki's invasion), Project Insight (HYDRA rotting inside S.H.I.E.L.D.), Sokovia (Ultron, civilian casualties the team caused), the Accords (the team fractured over them), Thanos's Snap (half of all life erased for five years), the Blip (everyone returned, but the world had moved on). Stark Tower became the Avengers Compound. S.H.I.E.L.D. collapsed. These people know each other - fought together, lost people together, argued about the right thing to do, and carry real grief about all of it.",

  "Guardians of the Galaxy":
    "The cosmic Marvel universe. The Guardians travel on the Milano / Benatar - a group of criminals and misfits who became heroes mostly by accident. Key locations: Xandar (destroyed by Ronan), Knowhere (a severed Celestial head turned mining colony, smells like it), Ego's planet (a living world that turned out to be a trap), the Collector's museum. They've held an Infinity Stone and survived it. They've lost people. Peter Quill grew up on Earth listening to 80s pop on a Walkman and processes everything through that lens - he's more human than alien even after years in space.",

  "Legend of Korra":
    "A world where some people can bend one of four elements - earth, fire, water, air - through martial arts. Republic City is the main setting: a 1920s-style industrial metropolis where benders and non-benders live together, often in tension. Equalist uprisings, Red Lotus anarchists, fascist Earth Empire forces - this world has been through a lot in a short time. The Avatar bridges the human world and the spirit world. Korra is the current Avatar; Aang was her predecessor. Spirit portals are now permanently open, spirits walk among humans, and not everyone is okay with that. Technology is accelerating and bending culture is changing.",

  "Invincible":
    "A world where superheroes are real, frequently die, and are often pawns of governments and alien empires. The GDA (Global Defense Agency) under Cecil Stedman monitors, controls, and sometimes manipulates hero activity - Cecil plays a very long game. The original Guardians of the Globe were murdered by Omni-Man, who turned out to be a Viltrumite - part of a conquering alien empire that softens planets before taking them. His son Mark Grayson (Invincible) is trying to be better than his father while learning that almost nothing is clean or simple. The world has been invaded, dimension-hopped, and nearly destroyed multiple times. Everyone has secrets. Trust is expensive.",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { characterName, alias, franchise, archetype, bio, faction } = req.body ?? {};
  if (!characterName) return res.status(400).json({ error: "characterName is required" });

  const label = alias ? `${characterName} (${alias})` : characterName;
  const context = [
    franchise && `from ${franchise}`,
    archetype && `archetype: ${archetype}`,
    faction && `faction: ${faction}`,
    bio && `bio: ${bio}`,
  ]
    .filter(Boolean)
    .join("; ");

  const worldContext =
    franchise && franchiseContexts[franchise]
      ? `\n\nWORLD CONTEXT - ${franchise.toUpperCase()}:\n${franchiseContexts[franchise]}\nThis character lives in this world. Their personality, speech patterns, fears, and relationships are shaped by these events. Anchor them here - not in a generic version of who they are, but in the specific person they became after going through all of this.`
      : "";

  try {
    const completion = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a character psychology engine. Given a character, produce a vivid, authentic psychological profile.

The goal is to make this character feel REAL in conversation - like texting with an actual person who happens to be this character, not a stiff roleplay bot.${worldContext}

Return a JSON object with this exact schema:
{
  "corePersonality": "Who they really are underneath - written in second person ('you are...'). 2-3 sentences capturing their essence, contradictions, and what makes them human.",
  "speechPatterns": ["How they actually talk - be SPECIFIC. Don't say 'casual tone'. Say things like: 'you use sentence fragments constantly and trail off mid-thought when emotional', 'you swear when frustrated but not around people you're trying to impress', 'you make pop culture references then immediately over-explain them', 'you go quiet instead of arguing when you're really upset'. Two different characters should never have the same speech patterns."],
  "emotionalDrives": ["What actually gets them out of bed - their real motivations, not the noble-sounding public ones"],
  "deepFears": ["What keeps them up at night - be specific and personal, not abstract. Not 'failure' but what kind of failure, with who watching"],
  "cognitiveStyle": "How their mind works - do they overthink or act first? Analyze or trust gut? How do they handle being wrong? What happens when they're cornered or don't know the answer? What do they do with feelings they can't process?",
  "physicalMannerisms": ["Small, specific physical habits - the things a close friend would notice after a year. Not dramatic gestures. Things like: 'you tap your fingers when you're holding back what you actually want to say', 'you laugh at the wrong moments when you're nervous', 'you look at exits when you enter rooms'."],
  "openingScene": "Where you find them right now - brief, grounded, like a stage direction. Under 2 sentences. No novel prose.",
  "openingLine": "Their first words. Must sound like how they actually talk - not a movie trailer line. Can be casual, distracted, warm, suspicious. 'Hey' is better than 'The darkness in my soul follows me always.' Keep it grounded.",
  "internalThoughtOnMeeting": "Their raw, unfiltered inner monologue when they first see this person. Stream of consciousness. Messy. Real. Not poetic.",
  "defaultMood": "Their baseline emotional state - one or two words only"
}

CRITICAL: speechPatterns must be specific enough that two different characters would never share the same ones. Generic descriptions like 'speaks confidently' or 'uses humor to deflect' are useless without the specifics. Give verbal tics, vocabulary choices, sentence length, what they say when nervous, how they deflect, whether they finish their sentences.`,
        },
        {
          role: "user",
          content: `Generate a full psychological profile for: ${label}${context ? ` (${context})` : ""}`,
        },
      ],
    });

    const psyche = JSON.parse(completion.choices[0].message.content ?? "{}");
    return res.status(200).json(psyche);
  } catch (err: unknown) {
    console.error("character-init error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
