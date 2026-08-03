import { useState } from "react";
import { X, MapPin, Loader, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function LocationEventPin({ location, sessionId, onClose, onEventPinned }) {
  const [eventForm, setEventForm] = useState({ title: "", description: "", event_type: "story" });
  const [loading, setLoading] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);

  const handlePinEvent = async () => {
    if (!eventForm.title.trim()) return;

    setLoading(true);
    try {
      // Create lore entry tied to location
      const loreEntry = await base44.entities.WorldState.create({
        session_id: sessionId,
        category: "event",
        subject: location.name,
        fact: `[${eventForm.event_type.toUpperCase()}] ${eventForm.title}: ${eventForm.description}`,
        importance: "medium",
        is_active: true,
        source_message_index: 0,
      });

      // Create location-event relation via memo
      onEventPinned({ location, event: eventForm, loreId: loreEntry.id });
      setEventForm({ title: "", description: "", event_type: "story" });
    } catch (err) {
      console.error("Error pinning event:", err);
    } finally {
      setLoading(false);
    }
  };

  const generateAISuggestion = async () => {
    setGeneratingAI(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a brief, compelling narrative event that could occur at "${location.name}" (a ${location.category} location). The event should be mysterious, engaging, and relevant to an interactive story. Return in JSON format: {"title": "event title", "description": "2-3 sentence description", "event_type": "mystery|discovery|conflict|revelation"}`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            event_type: { type: "string" },
          },
        },
      });

      if (result.title) {
        setEventForm(result);
      }
    } catch (err) {
      console.error("Error generating event:", err);
    } finally {
      setGeneratingAI(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-background border border-primary/30 hud-corner glow-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-primary/20">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary/60" />
            <h2 className="font-mono text-primary tracking-[0.2em] uppercase">Pin Event</h2>
          </div>
          <button onClick={onClose} className="text-primary/30 hover:text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <div className="p-3 bg-primary/5 border border-primary/20 rounded">
            <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">Location</p>
            <p className="text-sm font-mono text-primary/80 mt-1">{location.name}</p>
          </div>

          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Event Title</label>
            <input
              value={eventForm.title}
              onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              placeholder="e.g., The Lost Archive Discovered..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Description</label>
            <textarea
              value={eventForm.description}
              onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
              placeholder="What happened or what was discovered..."
              rows={3}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-1">Event Type</label>
            <select
              value={eventForm.event_type}
              onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}
              className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            >
              {["story", "discovery", "conflict", "mystery", "revelation"].map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <button
            onClick={generateAISuggestion}
            disabled={generatingAI}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-cyan-400/30 text-cyan-400/70 hover:text-cyan-400 hover:border-cyan-400/50 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            {generatingAI ? (
              <>
                <Loader className="w-3 h-3 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Zap className="w-3 h-3" />
                AI Suggest
              </>
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-primary/20">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary/60 font-mono text-xs tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handlePinEvent}
            disabled={!eventForm.title.trim() || loading}
            className="flex-1 px-4 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
          >
            {loading ? "Pinning..." : "Pin Event"}
          </button>
        </div>
      </div>
    </div>
  );
}