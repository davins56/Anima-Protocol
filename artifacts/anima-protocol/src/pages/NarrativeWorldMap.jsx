// @ts-check
import { useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import NarrativeWorldMapGraph from "@/components/world/NarrativeWorldMapGraph";
import { Zap, GitBranch } from "lucide-react";

export default function NarrativeWorldMap() {
  const { sessionId } = useParams();
  const [jumpLoading, setJumpLoading] = useState(false);
  const [jumpedTo, setJumpedTo] = useState(null);

  const handleSelectBranch = async (/** @type {any} */ snapshot) => {
    if (snapshot.is_active) return;
    
    setJumpLoading(true);
    try {
      const result = await base44.functions.invoke("restoreWorldBranch", {
        snapshot_id: snapshot.id,
        session_id: sessionId,
      });

      if (result?.data?.success) {
        setJumpedTo(snapshot.branch_name);
        setTimeout(() => setJumpedTo(null), 3000);
      }
    } catch (err) {
      console.error("Error jumping to timeline:", err);
    } finally {
      setJumpLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <GitBranch className="w-6 h-6 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-mono text-primary glow-text tracking-widest uppercase">
              Narrative Multiverse
            </h1>
          </div>
          <p className="text-primary/60 font-mono text-xs sm:text-sm tracking-wider">
            Explore all possible timelines and alternate realities branching from your story
          </p>
        </div>

        {/* Status Message */}
        {jumpedTo && (
          <div className="p-3 border border-green-400/30 bg-green-400/5 rounded animate-pulse">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-green-400" />
              <span className="font-mono text-[9px] text-green-400 tracking-widest uppercase">
                Jumped to timeline: {jumpedTo}
              </span>
            </div>
          </div>
        )}

        {/* Main Graph */}
        <NarrativeWorldMapGraph
          sessionId={sessionId}
          onSelectBranch={handleSelectBranch}
        />

        {/* Info Panel */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 border border-primary/15 bg-black/30 rounded">
            <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase mb-2">
              Active Mechanics
            </h3>
            <ul className="space-y-1 text-[9px] font-mono text-primary/50">
              <li>• Force-directed graph layout</li>
              <li>• Parent-child relationships</li>
              <li>• Physics simulation</li>
              <li>• Real-time timeline data</li>
            </ul>
          </div>

          <div className="p-4 border border-primary/15 bg-black/30 rounded">
            <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase mb-2">
              How to Use
            </h3>
            <ul className="space-y-1 text-[9px] font-mono text-primary/50">
              <li>• Hover over nodes to see names</li>
              <li>• Click to select and view details</li>
              <li>• Jump button switches realities</li>
              <li>• Cyan = active timeline</li>
            </ul>
          </div>

          <div className="p-4 border border-primary/15 bg-black/30 rounded">
            <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase mb-2">
              Timeline Data
            </h3>
            <ul className="space-y-1 text-[9px] font-mono text-primary/50">
              <li>• Decision points tracked</li>
              <li>• Outcome summaries stored</li>
              <li>• Political/environmental impact</li>
              <li>• Key events recorded</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}