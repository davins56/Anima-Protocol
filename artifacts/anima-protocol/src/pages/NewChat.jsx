import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import NewSessionModal from "@/components/chat/NewSessionModal";
import { Users, User } from "lucide-react";

export default function NewChat() {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async ({ mode: m, character_id, group_character_ids, opening_scene }) => {
    setCreating(true);
    try {
      let title = "New Session";
      let initialMessages = [];

      if (m === "solo" && character_id) {
        const chars = await base44.entities.Character.list("-created_date", 500);
        const animas = await base44.entities.Anima.list("-created_date", 100);
        const all = [...(chars || []), ...(animas || [])];
        const char = all.find((c) => c.id === character_id);
        title = char ? char.name : "New Session";
      } else if (m === "group" && group_character_ids?.length) {
        const chars = await base44.entities.Character.list("-created_date", 500);
        const animas = await base44.entities.Anima.list("-created_date", 100);
        const all = [...(chars || []), ...(animas || [])];
        const groupChars = all.filter((c) => group_character_ids.includes(c.id));
        title =
          groupChars.slice(0, 2).map((c) => c.name).join(", ") +
          (groupChars.length > 2 ? ` +${groupChars.length - 2}` : "");
        const charNames = groupChars.map((c) => c.name).join(", ");
        initialMessages = [
          {
            role: "assistant",
            character_name: "Narrator",
            content: `The stage is set. ${charNames} find themselves drawn together by fate or circumstance. The air crackles with potential as these extraordinary beings come face to face. What unfolds next will alter the course of events. The scene awaits...`,
            timestamp: new Date().toISOString(),
          },
        ];
      }

      const newSession = await base44.entities.ChatSession.create({
        mode: m,
        character_id: character_id || null,
        group_character_ids: group_character_ids || [],
        title,
        messages: initialMessages,
        opening_scene: opening_scene || null,
      });

      if (initialMessages.length > 0) {
        await base44.entities.ChatSession.update(newSession.id, { messages: initialMessages });
      }

      navigate(`/chat/${newSession.id}`, { replace: true });
    } catch (err) {
      console.error("Failed to create session:", err);
      setCreating(false);
      setMode(null);
    }
  };

  if (creating) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-3">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="font-mono text-xs text-primary/50 tracking-widest uppercase">Initializing session...</p>
      </div>
    );
  }

  if (mode) {
    return (
      <NewSessionModal
        mode={mode}
        onClose={() => setMode(null)}
        onCreate={handleCreate}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full w-full px-6 gap-8">
      <div className="text-center space-y-2">
        <h1 className="font-mono text-xl tracking-widest uppercase text-primary">New Session</h1>
        <p className="text-primary/50 text-sm">Choose your interaction mode</p>
      </div>

      <div className="flex flex-col w-full max-w-sm gap-4">
        <button
          onClick={() => setMode("solo")}
          className="group relative flex items-center gap-4 w-full p-5 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-all duration-200 text-left"
        >
          <div className="flex-shrink-0 w-12 h-12 rounded-full border border-primary/30 bg-primary/10 flex items-center justify-center group-hover:border-primary/60 transition-colors">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="font-mono text-sm tracking-wider uppercase text-primary">Solo</div>
            <div className="text-primary/50 text-xs mt-0.5">One-on-one with a single character</div>
          </div>
        </button>

        <button
          onClick={() => setMode("group")}
          className="group relative flex items-center gap-4 w-full p-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10 hover:border-cyan-500/40 transition-all duration-200 text-left"
        >
          <div className="flex-shrink-0 w-12 h-12 rounded-full border border-cyan-500/30 bg-cyan-500/10 flex items-center justify-center group-hover:border-cyan-500/60 transition-colors">
            <Users className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="font-mono text-sm tracking-wider uppercase text-cyan-400">Group</div>
            <div className="text-primary/50 text-xs mt-0.5">Multi-character ensemble session</div>
          </div>
        </button>
      </div>
    </div>
  );
}
