import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
declare const process: { env: Record<string, string | undefined> };

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { messages } = req.body;

  const completion = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Identify new world facts, items, or character details from this chat. Return JSON: { entries: [{ title, body, category: 'item'|'location'|'lore' }] }",
      },
      { role: "user", content: JSON.stringify(messages.slice(-10)) },
    ],
  });

  res
    .status(200)
    .json(JSON.parse(completion.choices[0].message.content || "{}"));
}

