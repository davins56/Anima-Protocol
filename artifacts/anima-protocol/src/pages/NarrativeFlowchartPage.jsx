import { useSearchParams, useNavigate } from "react-router-dom";
import NarrativeFlowchart from "@/components/branching/NarrativeFlowchart";
import CharacterVoiceConfig from "@/components/voice/CharacterVoiceConfig";
import { ChevronLeft, Volume2, GitBranch } from "lucide-react";
import { useState } from "react";

export default function NarrativeFlowchartPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get("session");
  const [activeTab, setActiveTab] = useState("flowchart");
  const [restoringSnapshot, setRestoringSnapshot] = useState(null);

  const handleRestore = async (snapshot) => {
    setRestoringSnapshot(snapshot);
    // The actual restoration would be handled by the Chat page
    // This just passes the snapshot info
  };

  const handleFork = (snapshot) => {
    // Trigger fork creation
    window.alert(`Fork from: ${snapshot.branch_name}`);
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="lg:hidden text-primary/40 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-mono text-2xl sm:text-3xl text-primary glow-text tracking-[0.2em] uppercase">
              // Story Control
            </h1>
            <p className="text-[10px] font-mono text-primary/50 mt-1 tracking-widest">
              Narrative Flowchart & Voice Configuration
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-primary/10">
          <button
            onClick={() => setActiveTab("flowchart")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
              activeTab === "flowchart"
                ? "border-primary text-primary"
                : "border-transparent text-primary/40 hover:text-primary/70"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Narrative Branches
          </button>
          <button
            onClick={() => setActiveTab("voices")}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 font-mono text-[9px] tracking-widest uppercase transition-all ${
              activeTab === "voices"
                ? "border-primary text-primary"
                : "border-transparent text-primary/40 hover:text-primary/70"
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            Voice Config
          </button>
        </div>

        {/* Content */}
        {sessionId ? (
          <>
            {activeTab === "flowchart" && (
              <div className="space-y-4">
                <p className="text-[10px] font-mono text-primary/50 tracking-widest">
                  Click any branch to view details, restore the story from that point, or fork a new timeline.
                </p>
                <NarrativeFlowchart
                  sessionId={sessionId}
                  onRestore={handleRestore}
                  onFork={handleFork}
                />
              </div>
            )}

            {activeTab === "voices" && (
              <div className="space-y-4">
                <p className="text-[10px] font-mono text-primary/50 tracking-widest">
                  Assign ElevenLabs voices to characters and preview their dialogue.
                </p>
                <CharacterVoiceConfig sessionId={sessionId} />
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-96 border border-primary/20 bg-black/30 rounded">
            <div className="text-center space-y-3">
              <p className="font-mono text-lg text-primary/60 tracking-widest uppercase">
                Select a Session
              </p>
              <p className="text-[10px] font-mono text-primary/30 max-w-sm">
                Open a chat session from the sidebar to access story controls.
              </p>
            </div>
          </div>
        )}

        {/* Info Panel */}
        <div className="p-4 border border-primary/15 bg-black/40 rounded space-y-2">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            💡 Features
          </p>
          <ul className="text-[9px] font-mono text-primary/60 space-y-1 ml-4">
            <li>• <strong>Flowchart:</strong> Visual branching tree of story snapshots</li>
            <li>• <strong>Restore:</strong> Rewind to any previous story state</li>
            <li>• <strong>Fork:</strong> Create alternate timeline from decision point</li>
            <li>• <strong>Voice Config:</strong> Assign unique voices to each character</li>
            <li>• <strong>Preview:</strong> Test dialogue in character's voice before deployment</li>
            <li>• <strong>Lore Extraction:</strong> Automatic world-building detail parsing (in background)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}