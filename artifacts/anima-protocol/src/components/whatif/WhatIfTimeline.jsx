import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, GitBranch, CheckCircle2, Layers, Trash2, RefreshCw, ChevronRight, Clock, Zap } from "lucide-react";
import { format } from "date-fns";

export default function WhatIfTimeline({
  session,
  snapshots,
  selectedSnapshot,
  onSelectSnapshot,
  onCreateBranch,
  onDelete,
  onRestore,
  compareSnapshots,
  onToggleCompare,
}) {
  const svgRef = useRef(null);
  const [svgDims, setSvgDims] = useState({ width: 800, height: 600 });
  const [positions, setPositions] = useState({});
  const [hoveredId, setHoveredId] = useState(null);

  useEffect(() => {
    const updateDims = () => {
      if (svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        setSvgDims({ width: rect.width, height: rect.height });
      }
    };
    updateDims();
    window.addEventListener("resize", updateDims);
    return () => window.removeEventListener("resize", updateDims);
  }, []);

  useEffect(() => {
    if (snapshots.length > 0) calculateLayout(snapshots);
  }, [snapshots, svgDims]);

  const buildTree = (snaps) => {
    const childMap = {};
    const rootIds = [];
    snaps.forEach(s => {
      if (s.parent_snapshot_id) {
        if (!childMap[s.parent_snapshot_id]) childMap[s.parent_snapshot_id] = [];
        childMap[s.parent_snapshot_id].push(s.id);
      } else {
        rootIds.push(s.id);
      }
    });
    return { childMap, rootIds };
  };

  const calculateLayout = (snaps) => {
    const { childMap, rootIds } = buildTree(snaps);
    const VERT_GAP = 140;
    const HORIZ_GAP = 220;
    const TOP_PAD = 80;
    const newPos = {};

    const assign = (id, depth, parentX, sibIdx, sibCount) => {
      const x = parentX + (sibIdx - (sibCount - 1) / 2) * HORIZ_GAP;
      const y = TOP_PAD + depth * VERT_GAP;
      newPos[id] = { x, y };
      const children = childMap[id] || [];
      children.forEach((cid, idx) => assign(cid, depth + 1, x, idx, children.length));
    };

    rootIds.forEach((rid, idx) => assign(rid, 0, svgDims.width / 2, idx, rootIds.length));
    setPositions(newPos);
  };

  const getEdges = () => {
    return snapshots
      .filter(s => s.parent_snapshot_id && positions[s.parent_snapshot_id] && positions[s.id])
      .map(s => ({
        id: s.id,
        from: positions[s.parent_snapshot_id],
        to: positions[s.id],
        active: s.is_active,
      }));
  };

  const getNodeColor = (snap) => {
    if (snap.is_active) return "#00e5e5";
    if (compareSnapshots?.find(c => c.id === snap.id)) return "#a78bfa";
    if (selectedSnapshot?.id === snap.id) return "#fbbf24";
    return "#4ade80";
  };

  const edges = getEdges();
  const maxY = Math.max(...Object.values(positions).map(p => p.y), 400);
  const svgHeight = Math.max(maxY + 120, 400);

  if (snapshots.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
        <GitBranch className="w-10 h-10 text-primary/20 mx-auto" />
        <div>
          <p className="font-mono text-xs text-primary/40 tracking-widest uppercase mb-2">No What-If Scenarios Yet</p>
          <p className="font-mono text-[9px] text-primary/25">Create your first alternative timeline for this session</p>
        </div>
        <button
          onClick={() => onCreateBranch(null)}
          className="px-5 py-2.5 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          Create First Scenario
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* SVG Tree View */}
      <div className="flex-1 overflow-auto relative" ref={svgRef}>
        {/* Toolbar */}
        <div className="sticky top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-2 bg-black/80 backdrop-blur-md border-b border-primary/10">
          <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase flex-1">
            {snapshots.length} timeline{snapshots.length !== 1 ? "s" : ""} · {session.title}
          </p>
          <button
            onClick={() => onCreateBranch(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[8px] tracking-widest uppercase transition-all"
          >
            <Plus className="w-3 h-3" />
            New Scenario
          </button>
        </div>

        <svg
          width="100%"
          height={svgHeight}
          style={{ minWidth: `${svgDims.width}px`, display: "block" }}
          className="bg-gradient-to-b from-black/10 to-black/30"
        >
          {/* Grid background */}
          <defs>
            <pattern id="wif-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(185 100% 50% / 0.04)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wif-grid)" />

          {/* Edges */}
          {edges.map(edge => {
            const midY = (edge.from.y + edge.to.y) / 2;
            return (
              <g key={`edge-${edge.id}`}>
                <path
                  d={`M ${edge.from.x} ${edge.from.y} C ${edge.from.x} ${midY}, ${edge.to.x} ${midY}, ${edge.to.x} ${edge.to.y}`}
                  fill="none"
                  stroke={edge.active ? "#00e5e5" : "#4ade80"}
                  strokeWidth={edge.active ? 2 : 1.5}
                  strokeDasharray={edge.active ? "0" : "6,4"}
                  opacity={0.5}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {snapshots.map(snap => {
            const pos = positions[snap.id];
            if (!pos) return null;
            const isSelected = selectedSnapshot?.id === snap.id;
            const isHovered = hoveredId === snap.id;
            const isCompare = compareSnapshots?.find(c => c.id === snap.id);
            const color = getNodeColor(snap);
            const r = isSelected ? 30 : 22;

            return (
              <g
                key={snap.id}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectSnapshot(snap)}
                onMouseEnter={() => setHoveredId(snap.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Glow ring */}
                {(snap.is_active || isSelected) && (
                  <circle cx={pos.x} cy={pos.y} r={r + 10} fill="none" stroke={color} strokeWidth={1} opacity={0.2} className="animate-pulse" />
                )}
                {/* Main circle */}
                <circle cx={pos.x} cy={pos.y} r={r} fill={`${color}22`} stroke={color} strokeWidth={isSelected ? 2.5 : 1.5} />
                {/* Active indicator */}
                {snap.is_active && (
                  <circle cx={pos.x} cy={pos.y} r={r - 8} fill={color} opacity={0.4} />
                )}
                {/* Branch icon text */}
                <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" fontSize={r > 25 ? 14 : 11} fill={color} fontFamily="monospace">
                  {snap.branch_name?.[0]?.toUpperCase() || "?"}
                </text>
                {/* Compare badge */}
                {isCompare && (
                  <circle cx={pos.x + r - 4} cy={pos.y - r + 4} r={6} fill="#a78bfa" />
                )}
                {/* Label */}
                <foreignObject x={pos.x - 70} y={pos.y + r + 4} width={140} height={40} className="pointer-events-none">
                  <div xmlns="http://www.w3.org/1999/xhtml" style={{ textAlign: "center" }}>
                    <p style={{ fontFamily: "monospace", fontSize: "9px", color, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {snap.branch_name}
                    </p>
                    {snap.is_active && (
                      <p style={{ fontFamily: "monospace", fontSize: "7px", color: "#00e5e5", opacity: 0.6, marginTop: "2px" }}>ACTIVE</p>
                    )}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Details Panel */}
      <AnimatePresence>
        {selectedSnapshot && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-72 border-l border-primary/20 bg-black/60 flex flex-col overflow-hidden flex-shrink-0"
          >
            <div className="px-4 py-3 border-b border-primary/10 flex items-center justify-between">
              <div>
                <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase">Scenario</p>
                <p className="font-mono text-xs text-primary mt-0.5 truncate">{selectedSnapshot.branch_name}</p>
              </div>
              <button onClick={() => onSelectSnapshot(null)} className="text-primary/30 hover:text-primary">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${selectedSnapshot.is_active ? "bg-primary animate-pulse" : "bg-green-400"}`} />
                <span className="font-mono text-[9px] text-primary/70">
                  {selectedSnapshot.is_active ? "Active Timeline" : "Alternate Timeline"}
                </span>
              </div>

              {/* Depth */}
              <div>
                <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1">Branching Depth</p>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.max((selectedSnapshot.depth || 0) + 1, 1) }).map((_, i) => (
                    <div key={i} className={`w-4 h-1 rounded ${i <= (selectedSnapshot.depth || 0) ? "bg-primary" : "bg-primary/20"}`} />
                  ))}
                  <span className="font-mono text-[8px] text-primary/50 ml-1">Level {selectedSnapshot.depth || 0}</span>
                </div>
              </div>

              {/* Decision */}
              {selectedSnapshot.decision_point && (
                <div>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">Pivotal Decision</p>
                  <div className="border-l-2 border-primary/30 pl-3">
                    <p className="font-mono text-[9px] text-primary/80 leading-relaxed">{selectedSnapshot.decision_point}</p>
                  </div>
                </div>
              )}

              {/* Outcome */}
              {selectedSnapshot.outcome_summary && (
                <div>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">Outcome</p>
                  <p className="font-mono text-[9px] text-primary/70 leading-relaxed">{selectedSnapshot.outcome_summary}</p>
                </div>
              )}

              {/* Key Events */}
              {selectedSnapshot.key_events?.length > 0 && (
                <div>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">Key Events</p>
                  <ul className="space-y-1">
                    {selectedSnapshot.key_events.slice(0, 4).map((ev, i) => (
                      <li key={i} className="font-mono text-[9px] text-primary/60 flex gap-1.5">
                        <Zap className="w-2.5 h-2.5 text-primary/40 flex-shrink-0 mt-0.5" />
                        {ev}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Political */}
              {selectedSnapshot.political_outcome && (
                <div>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1.5">Political Landscape</p>
                  <p className="font-mono text-[9px] text-primary/60 leading-relaxed line-clamp-3">{selectedSnapshot.political_outcome}</p>
                </div>
              )}

              {/* Created */}
              {selectedSnapshot.created_date && (
                <div>
                  <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-1">Created</p>
                  <p className="font-mono text-[9px] text-primary/50 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {format(new Date(selectedSnapshot.created_date), "MMM d, yyyy")}
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-primary/10 p-3 space-y-2">
              <button
                onClick={() => onCreateBranch(selectedSnapshot)}
                className="w-full py-2 border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-3 h-3" />
                Branch From This
              </button>
              <button
                onClick={() => onToggleCompare(selectedSnapshot)}
                className={`w-full py-2 border font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2 ${
                  compareSnapshots?.find(c => c.id === selectedSnapshot.id)
                    ? "border-purple-400/50 bg-purple-400/10 text-purple-400"
                    : "border-primary/20 text-primary/50 hover:text-primary hover:border-primary/40"
                }`}
              >
                <Layers className="w-3 h-3" />
                {compareSnapshots?.find(c => c.id === selectedSnapshot.id) ? "Remove From Compare" : "Add to Compare"}
              </button>
              {!selectedSnapshot.is_active && (
                <button
                  onClick={() => onRestore(selectedSnapshot)}
                  className="w-full py-2 border border-green-400/30 bg-green-400/5 text-green-400 hover:bg-green-400/15 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  Set As Active
                </button>
              )}
              <button
                onClick={() => onDelete(selectedSnapshot)}
                className="w-full py-2 border border-red-400/20 text-red-400/50 hover:text-red-400 hover:border-red-400/40 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-3 h-3" />
                Delete Scenario
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}