import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, RefreshCw, Plus, X, Loader } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import StorypointCard from "@/components/storyboard/StorypointCard";
import ForkSessionModal from "@/components/storyboard/ForkSessionModal";
import NarrativeTimeline from "@/components/storyboard/NarrativeTimeline";

export default function Storyboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [storypoints, setStorypoints] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingFor, setGeneratingFor] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({ title: "", summary: "" });
  const [savingForm, setSavingForm] = useState(false);
  const [forkingPoint, setForkingPoint] = useState(null);



  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [sessions, storypoints, characters] = await Promise.all([
      base44.entities.ChatSession.list("-updated_date", 100),
      base44.entities.Storypoint.list("order", 200),
      base44.entities.Character.list("-created_date", 100),
    ]);
    setSessions(sessions);
    setStorypoints(storypoints.sort((a, b) => (a.order || 0) - (b.order || 0)));
    setCharacters(characters);
    setLoading(false);
  };

  const generateSessionSummary = async (sessionId) => {
    setGeneratingFor(sessionId);
    const session = sessions.find((s) => s.id === sessionId);
    if (!session?.messages?.length) {
      setGeneratingFor(null);
      return;
    }

    const conversationText = session.messages
      .slice(-10)
      .map((m) => `${m.character_name || "User"}: ${m.content}`)
      .join("\n");

    try {
      const summary = await base44.integrations.Core.InvokeLLM({
        prompt: `Summarize this chat conversation into a dramatic narrative beat (2-3 sentences). Focus on character development, conflicts, and memorable moments:\n\n${conversationText}`,
      });

      const title = await base44.integrations.Core.InvokeLLM({
        prompt: `Create a short, dramatic title (3-5 words) for this narrative moment:\n${summary}`,
      });

      const existingPoint = storypoints.find((s) => s.session_id === sessionId);
      const newPoint = {
        session_id: sessionId,
        title: title.slice(0, 50),
        summary,
        order: existingPoint?.order ?? storypoints.length,
        key_moments: session.messages.slice(-5).map((_, i) => i.toString()),
        characters_involved: [session.character_id].filter(Boolean),
      };

      if (existingPoint) {
        await base44.entities.Storypoint.update(existingPoint.id, newPoint);
      } else {
        await base44.entities.Storypoint.create(newPoint);
      }

      await loadData();
    } finally {
      setGeneratingFor(null);
    }
  };

  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const handleDragStart = (id) => setDraggedId(id);
  const handleDragOver = (id) => setDragOverId(id);
  const handleDragEnd = async (id) => {
    if (!dragOverId || draggedId === dragOverId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const oldIndex = storypoints.findIndex((s) => s.id === draggedId);
    const newIndex = storypoints.findIndex((s) => s.id === dragOverId);
    
    const newOrder = [...storypoints];
    const [movedItem] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, movedItem);

    const updates = newOrder.map((point, idx) =>
      base44.entities.Storypoint.update(point.id, { order: idx })
    );
    await Promise.all(updates);
    
    setDraggedId(null);
    setDragOverId(null);
    await loadData();
  };

  const handleCreateStorypoint = async () => {
    if (!newForm.title.trim() || !newForm.summary.trim()) return;
    setSavingForm(true);
    await base44.entities.Storypoint.create({
      title: newForm.title,
      summary: newForm.summary,
      order: storypoints.length,
      session_id: "",
      key_moments: [],
      characters_involved: [],
    });
    setNewForm({ title: "", summary: "" });
    setShowNewForm(false);
    await loadData();
    setSavingForm(false);
  };

  const deleteStorypoint = async (id) => {
    await base44.entities.Storypoint.delete(id);
    await loadData();
  };

  const handleForkSession = (point) => {
    setForkingPoint(point);
  };

  const handleForkSuccess = (forkedSessionId) => {
    navigate(`/chat/${forkedSessionId}`);
  };

  return (
    <div className="min-h-[100dvh] bg-background scanline">
      {/* Header */}
      <div className="border-b border-primary/20 bg-black/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">
                // Storyboard
              </h1>
              <p className="text-[10px] font-mono text-primary/30 tracking-widest uppercase mt-0.5">
                {storypoints.length} narrative beats
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-2 px-5 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 transition-all font-mono text-xs tracking-widest uppercase hud-corner glow-border"
          >
            <Plus className="w-4 h-4" />
            New Beat
          </button>
        </div>
      </div>

      <div className="w-full p-3 sm:p-6 pb-24 sm:pb-6 space-y-6 sm:space-y-8">
        {loading ? (
          <div className="text-center py-12 font-mono text-primary/30 text-xs sm:text-sm animate-pulse">
            Loading...
          </div>
        ) : (
          <>
            {/* Timeline Dashboard */}
            <NarrativeTimeline 
              storypoints={storypoints}
              sessions={sessions}
              characters={characters}
              onSelectSession={(sessionId) => navigate(`/chat/${sessionId}`)}
              onSelectStorypoint={(storyId) => {
                const point = storypoints.find(s => s.id === storyId);
                if (point?.session_id) navigate(`/chat/${point.session_id}`);
              }}
            />

            {/* Sessions Quick Access */}
             {sessions.length > 0 && (
               <div className="mb-6 sm:mb-8">
                 <p className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2.5 sm:mb-3">
                   Generate
                 </p>
                 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 sm:gap-2">
                   {sessions.slice(0, 8).map((session) => (
                     <button
                       key={session.id}
                       onClick={() => generateSessionSummary(session.id)}
                       disabled={generatingFor === session.id}
                       className="p-2.5 sm:p-3 border border-primary/20 bg-black/40 text-primary/70 hover:text-primary hover:border-primary/40 font-mono text-[8px] sm:text-[10px] text-left transition-all truncate disabled:opacity-50"
                     >
                      {generatingFor === session.id ? (
                        <Loader className="w-3 h-3 animate-spin" />
                      ) : (
                        session.title || "Untitled"
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Storypoints */}
            {storypoints.length === 0 ? (
              <div className="text-center py-24">
                <p className="font-mono text-primary/20 text-sm tracking-[0.3em] uppercase mb-6">
                  No narrative beats yet
                </p>
                <button
                  onClick={() => setShowNewForm(true)}
                  className="px-8 py-3 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase hud-corner glow-border transition-all"
                >
                  + Create First Beat
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {storypoints.map((point, idx) => (
                  <div key={point.id} className="space-y-2">
                    <div
                      draggable
                      onDragStart={() => handleDragStart(point.id)}
                      onDragOver={() => handleDragOver(point.id)}
                      onDragEnd={() => handleDragEnd(point.id)}
                      className="cursor-move"
                    >
                      <StorypointCard
                        point={point}
                        index={idx}
                        isDragging={draggedId === point.id}
                        onDelete={() => deleteStorypoint(point.id)}
                        onFork={handleForkSession}
                      />
                    </div>
                    {point.follow_up_suggestions?.length > 0 && (
                      <div className="ml-4 p-3 border border-primary/15 bg-primary/5">
                        <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-2">
                          Suggested Follow-ups
                        </p>
                        <div className="space-y-1.5">
                          {point.follow_up_suggestions.map((suggestion, i) => (
                            <div
                              key={i}
                              className="text-[9px] font-mono text-primary/60 border-l-2 border-primary/20 pl-2 py-1"
                            >
                              <p className="font-bold">{suggestion.title}</p>
                              <p className="text-primary/50 text-[8px] mt-0.5">{suggestion.description}</p>
                              <p className="text-primary/30 text-[8px] mt-0.5 tracking-widest">
                                Impact: {suggestion.impact_scale}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* New Storypoint Modal */}
      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-background border border-primary/30 hud-corner glow-border">
            <div className="flex items-center justify-between p-6 border-b border-primary/20">
              <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                // New Narrative Beat
              </h2>
              <button
                onClick={() => setShowNewForm(false)}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  Title *
                </label>
                <input
                  value={newForm.title}
                  onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. The Betrayal Revealed"
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              <div>
                <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
                  Summary *
                </label>
                <textarea
                  value={newForm.summary}
                  onChange={(e) => setNewForm((f) => ({ ...f, summary: e.target.value }))}
                  placeholder="Describe this narrative moment..."
                  rows={4}
                  className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none"
                />
              </div>
            </div>

            <div className="p-6 border-t border-primary/20 flex justify-end gap-3">
              <button
                onClick={() => setShowNewForm(false)}
                className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateStorypoint}
                disabled={!newForm.title.trim() || !newForm.summary.trim() || savingForm}
                className="px-6 py-2 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
              >
                {savingForm ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fork Modal */}
      {forkingPoint && (
        <ForkSessionModal
          storypoint={forkingPoint}
          onClose={() => setForkingPoint(null)}
          onSuccess={handleForkSuccess}
        />
      )}
    </div>
  );
}