import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const response = await fetch(url);
    const html = await response.text();

    // Basic "Cleaning" logic:
    // In a real app, you'd use a library like 'cheerio' here.
    // For now, we'll strip HTML tags to get raw text.
    let text = html
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gms, "") // Remove scripts
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gms, "") // Remove styles
      .replace(/<[^>]+>/g, " ") // Strip tags
      .replace(/\s+/g, " ") // Clean whitespace
      .trim();

    // Take the first 3000 characters to stay within context limits
    const excerpt = text.slice(0, 3000);

    return res.status(200).json({
      content: excerpt,
      title: "Imported Story",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch story from link." });
  }
}
