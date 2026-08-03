import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X } from "lucide-react";

export default function ForkSessionModal({ storypoint, onClose, onSuccess }) {
  const [sessionName, setSessionName] = useState(`${storypoint.title} [ALT]`);
  const [saving, setSaving] = useState(false);

  const handleFork = async () => {
    if (!sessionName.trim()) return;
    setSaving(true);

    try {
      // Get original session
      const originalSession = await base44.entities.ChatSession.list("-updated_date", 200);
      const session = originalSession.find((s) => s.id === storypoint.session_id);

      if (!session) {
        setSaving(false);
        return;
      }

      // Create forked session with history up to this point
      const forkedSession = await base44.entities.ChatSession.create({
        title: sessionName,
        mode: session.mode,
        character_id: session.character_id || null,
        group_character_ids: session.group_character_ids || [],
        messages: session.messages || [],
        last_message: session.last_message || "",
        parent_session_id: session.id,
        fork_storypoint_id: storypoint.id,
      });

      setSaving(false);
      onClose();
      onSuccess(forkedSession.id);
    } catch (error) {
      console.error(error);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-background border border-primary/30 hud-corner glow-border">
        <div className="flex items-center justify-between p-6 border-b border-primary/20">
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
            // Fork Session
          </h2>
          <button
            onClick={onClose}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-[10px] font-mono text-primary/60 mb-3">
              Create a branching timeline from this narrative beat. The new session will contain all messages up to this point, allowing you to explore alternate paths.
            </p>
          </div>

          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Forked Session Name
            </label>
            <input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Give this branching timeline a name..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          <div className="border-t border-primary/20 pt-4">
            <p className="text-[9px] font-mono text-primary/30">
              <span className="text-primary/50">From:</span> {storypoint.title}
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-primary/20 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleFork}
            disabled={!sessionName.trim() || saving}
            className="px-6 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
          >
            {saving ? "Forking..." : "Create Fork"}
          </button>
        </div>
      </div>
    </div>
  );
}