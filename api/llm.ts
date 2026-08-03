import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, systemPrompt } = req.body ?? {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (systemPrompt && typeof systemPrompt === "string") {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.8,
      max_tokens: 1200,
    });

    return res.status(200).json({
      content: completion.choices[0]?.message?.content ?? "",
    });
  } catch (err) {
    console.error("llm error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
