// @ts-check
import { useSearchParams } from "react-router-dom";
import FactionNetworkGraph from "@/components/network/FactionNetworkGraph";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function FactionNetwork() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="lg:hidden text-primary/40 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-mono text-2xl sm:text-3xl text-primary glow-text tracking-[0.2em] uppercase">
              // Faction Network
            </h1>
            <p className="text-[10px] font-mono text-primary/50 mt-1 tracking-widest">
              Force-Directed Character & Allegiance Graph
            </p>
          </div>
        </div>

        {sessionId ? (
          <FactionNetworkGraph sessionId={sessionId} />
        ) : (
          <div className="flex items-center justify-center h-96 border border-primary/20 bg-black/30 rounded">
            <div className="text-center space-y-3">
              <p className="font-mono text-lg text-primary/60 tracking-widest uppercase">
                Select a Session
              </p>
              <p className="text-[10px] font-mono text-primary/30 max-w-sm">
                Open a chat session from the sidebar to view its faction network.
              </p>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="p-4 border border-primary/15 bg-black/40 rounded space-y-2">
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            💡 How it works
          </p>
          <ul className="text-[9px] font-mono text-primary/60 space-y-1 ml-4">
            <li>• Node size and color represent faction allegiances</li>
            <li>• Lines show character relationships and interaction strength</li>
            <li>• Hover nodes to see names, click to view full character details</li>
            <li>• The graph uses force-directed physics to organize characters naturally</li>
            <li>• Relationship tier and shared world events are shown in the modal</li>
          </ul>
        </div>
      </div>
    </div>
  );
}