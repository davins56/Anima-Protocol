import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { rawText, phone } = await req.json();

  // Smart parsing for Y/N style
  const lines = rawText.split("\n").filter((l) => l.trim().length > 3);

  const messages = lines.map((line) => {
    const clean = line.trim();
    if (clean.match(/^(You|Y\/N|Player):/i) || clean.startsWith("You ")) {
      return {
        role: "user",
        content: clean.replace(/^(You|Y\/N|Player):?\s*/i, "").trim(),
      };
    }
    return { role: "assistant", content: clean };
  });

  const story = {
    id: "yn-" + Date.now().toString(36),
    title: "Avengers & GOTG Crash Landing",
    messages,
    characters: [
      "Tony Stark",
      "Steve Rogers",
      "Bucky Barnes",
      "Peter Quill",
      "Gamora",
      "Rocket",
      "Drax",
    ],
    phoneNumber: phone || "5715896622",
    createdAt: new Date().toISOString(),
    nsfwIntensity: "high", // default for your style
  };

  // TODO: Save to your DB here

  return Response.json({ success: true, story });
}
