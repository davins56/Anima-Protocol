import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
declare const process: { env: Record<string, string | undefined> };

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { messages } = req.body;
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Analyze the conversation. Extract new facts, world-building details, or items discovered. Format as JSON: { entries: [{ title, body, category: 'lore'|'item'|'character' }] }",
        },
        { role: "user", content: JSON.stringify(messages.slice(-10)) },
      ],
    });
    res
      .status(200)
      .json(JSON.parse(completion.choices[0].message.content || "{}"));
  } catch (err) {
    res.status(500).json({ error: "Lore extraction failed" });
  }
}
