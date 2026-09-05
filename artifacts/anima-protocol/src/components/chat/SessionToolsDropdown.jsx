import { useRef, useState } from "react";
import { ChevronDown, Map, GitBranch, Scroll, X } from "lucide-react";
import PersistentQuestLog from "@/components/quests/PersistentQuestLog";
import WorldBranchingTreeView from "@/components/world/WorldBranchingTreeView";
import InteractiveWorldMap from "@/components/world/InteractiveWorldMap";
import InteractiveRegionalMap from "@/components/map/InteractiveRegionalMap";
import PortaledFixedPanel from "./PortaledFixedPanel";

const TOOLS = [
  { id: "quests", label: "Quest Log", icon: Scroll },
  { id: "branching", label: "Branching Timeline", icon: GitBranch },
  { id: "worldmap", label: "World Map", icon: Map },
];

export default function SessionToolsDropdown({
  sessionId,
  characterId,
  onSelectBranch,
  onCreateBranch,
}) {
  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const triggerRef = useRef(null);

  const handleSelect = (toolId) => {
    setActivePanel(toolId === activePanel ? null : toolId);
    setOpen(false);
  };

  const activeTool = TOOLS.find(t => t.id === activePanel);

  return (
    <div className="relative">
      {/* Dropdown trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(p => !p)}
        className={`flex items-center gap-1.5 px-3 py-1.5 border font-mono text-[8px] tracking-widest uppercase transition-all ${
          activePanel
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40"
        }`}
      >
        {activeTool ? <activeTool.icon className="w-3 h-3" /> : <Map className="w-3 h-3" />}
        <span className="hidden sm:inline">{activeTool?.label || "Tools"}</span>
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <PortaledFixedPanel
        open={open}
        onDismiss={() => setOpen(false)}
        anchorRef={triggerRef}
        align="left"
        className="w-44 border bg-black/95 backdrop-blur-xl overflow-hidden"
        panelStyle={{ borderColor: "rgba(0,255,200,0.15)" }}
        panelTestId="session-tools-menu"
        backdropTestId="session-tools-backdrop"
        backdropZClass="z-[1002]"
        panelZClass="z-[1003]"
        motionInitial={{ opacity: 0, y: -6, scale: 0.97 }}
        motionAnimate={{ opacity: 1, y: 0, scale: 1 }}
        motionExit={{ opacity: 0, y: -6, scale: 0.97 }}
        motionTransition={{ duration: 0.12 }}
      >
              {TOOLS.map(tool => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => handleSelect(tool.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 border-b text-left font-mono text-[9px] tracking-wider uppercase transition-all ${
                    activePanel === tool.id
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "text-primary/50 hover:bg-primary/5 hover:text-primary/80"
                  }`}
                  style={{ borderColor: "rgba(0,255,200,0.06)" }}
                >
                  <tool.icon className="w-3 h-3 flex-shrink-0" />
                  {tool.label}
                  {activePanel === tool.id && <span className="ml-auto text-[7px] text-primary/40">✓</span>}
                </button>
              ))}
              {activePanel && (
                <button
                  type="button"
                  onClick={() => { setActivePanel(null); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left font-mono text-[8px] tracking-widest uppercase text-red-400/40 hover:text-red-400/70 transition-all"
                >
                  <X className="w-3 h-3" />
                  Close Panel
                </button>
              )}
      </PortaledFixedPanel>

      <PortaledFixedPanel
        open={Boolean(activePanel)}
        anchorRef={triggerRef}
        align="left"
        className="w-[min(560px,90vw)] border bg-black/95 backdrop-blur-xl overflow-hidden"
        panelStyle={{ borderColor: "rgba(0,255,200,0.15)" }}
        panelTestId="session-tools-panel"
        panelZClass="z-[1003]"
        motionInitial={{ opacity: 0, y: -6 }}
        motionAnimate={{ opacity: 1, y: 0 }}
        motionExit={{ opacity: 0, y: -6 }}
        motionTransition={{ duration: 0.2 }}
      >
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "rgba(0,255,200,0.08)" }}>
              <div className="flex items-center gap-2">
                {activeTool && <activeTool.icon className="w-3 h-3 text-primary/50" />}
                <span className="font-mono text-[9px] text-primary/50 tracking-widest uppercase">{activeTool?.label}</span>
              </div>
              <button type="button" onClick={() => setActivePanel(null)} className="text-primary/20 hover:text-primary/60 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Panel body */}
            <div className="max-h-80 overflow-y-auto p-3 pb-8">
              {activePanel === "quests" && (
                <PersistentQuestLog sessionId={sessionId} characterId={characterId} />
              )}
              {activePanel === "branching" && (
                <WorldBranchingTreeView
                  sessionId={sessionId}
                  onSelectBranch={onSelectBranch}
                  onCreateBranch={onCreateBranch}
                />
              )}
              {activePanel === "worldmap" && (
                <div className="space-y-3">
                  <InteractiveWorldMap sessionId={sessionId} />
                  <InteractiveRegionalMap sessionId={sessionId} />
                </div>
              )}
            </div>
      </PortaledFixedPanel>
    </div>
  );
}