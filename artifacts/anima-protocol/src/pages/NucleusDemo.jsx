import { useMemo } from "react";
import ChatExperienceNucleus from "@/components/chat/ChatExperienceNucleus";

const demoCharacters = [
  {
    id: "demo-char-1",
    name: "Astra",
    universe: "The Veil",
  },
];

const demoMessages = [
  {
    id: "welcome-1",
    role: "assistant",
    content: "Welcome to the new chat nucleus. This is the foundation for the full companion experience.",
    timestamp: new Date().toISOString(),
  },
];

export default function NucleusDemo() {
  const activeCharacter = useMemo(() => demoCharacters[0], []);

  return (
    <div className="min-h-screen bg-[#05070b] p-4 text-primary">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-6xl flex-col overflow-hidden rounded-2xl border border-primary/20 bg-black/40 shadow-2xl shadow-black/60">
        <ChatExperienceNucleus
          sessionId="nucleus-demo"
          initialMessages={demoMessages}
          characters={demoCharacters}
          activeCharacter={activeCharacter}
          mode="solo"
        />
      </div>
    </div>
  );
}
