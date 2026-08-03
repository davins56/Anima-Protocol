import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronDown, Loader, Plus, ArrowRight, Maximize2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function StoryBranchingGraph() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  
  const [snapshots, setSnapshots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [expandedDetails, setExpandedDetails] = useState(false);
  const [positions, setPositions] = useState({});
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 600 });
  const [viewBox, setViewBox] = useState(null);

  useEffect(() => {
    if (sessionId) loadData();
  }, [sessionId]);

  const loadData = async () => {
    setLoading(true);
    const [snapshotData, sessionData] = await Promise.all([
      base44.entities.WorldSnapshot.filter({ session_id: sessionId }, "-created_date", 100),
      base44.entities.ChatSession.filter({ id: sessionId }, "-updated_date", 1),
    ]);
    setSnapshots(snapshotData || []);
    setSessions(sessionData || []);
    calculateLayout(snapshotData || []);
    setLoading(false);
  };

  const calculateLayout = (snaps) => {
    if (!snaps || snaps.length === 0) return;

    const newPositions = {};
    const rootSnapshots = snaps.filter((s) => !s.parent_snapshot_id);
    const childMap = {};

    snaps.forEach((snap) => {
      if (snap.parent_snapshot_id) {
        if (!childMap[snap.parent_snapshot_id]) childMap[snap.parent_snapshot_id] = [];
        childMap[snap.parent_snapshot_id].push(snap.id);
      }
    });

    const assignPositions = (snapId, depth = 0, parentX = dimensions.width / 2, siblingIndex = 0, siblingCount = 1) => {
      const verticalSpacing = 120;
      const horizontalSpacing = 200;
      const y = 80 + depth * verticalSpacing;
      const x = parentX + (siblingIndex - (siblingCount - 1) / 2) * horizontalSpacing;

      newPositions[snapId] = { x, y };

      if (childMap[snapId]) {
        childMap[snapId].forEach((childId, idx) => {
          assignPositions(childId, depth + 1, x, idx, childMap[snapId].length);
        });
      }
    };

    rootSnapshots.forEach((root, idx) => {
      assignPositions(root.id, 0, dimensions.width / 2, idx, rootSnapshots.length);
    });

    setPositions(newPositions);
  };

  const handleNodeClick = (snapshot) => {
    setSelectedNode(snapshot);
    setExpandedDetails(true);
  };

  const handleRestoreBranch = async () => {
    if (!selectedNode) return;
    try {
      await base44.functions.invoke("restoreWorldBranch", {
        snapshot_id: selectedNode.id,
        session_id: sessionId,
      });
      // Reload data to reflect restored state
      await loadData();
      setExpandedDetails(false);
      setSelectedNode(null);
    } catch (err) {
      console.error("Error restoring branch:", err);
    }
  };

  const handleCreateBranch = () => {
    if (!selectedNode) return;
    navigate(`/branching?parentSnapshot=${selectedNode.id}&session=${sessionId}`);
  };

  const fitToScreen = useCallback(() => {
    if (!positions || Object.keys(positions).length === 0) return;
    const xs = Object.values(positions).map(p => p.x);
    const ys = Object.values(positions).map(p => p.y);
    const minX = Math.min(...xs) - 60;
    const minY = Math.min(...ys) - 60;
    const maxX = Math.max(...xs) + 60;
    const maxY = Math.max(...ys) + 60;
    setViewBox(`${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  }, [positions]);

  const getNodeColor = (snapshot) => {
    if (snapshot.is_active) return "#51cf66"; // green for active
    return "#74c0fc"; // blue for inactive
  };

  const getTierColor = (depth) => {
    const colors = ["#ff6b9d", "#ffd43b", "#74c0fc", "#51cf66", "#845ef7"];
    return colors[depth % colors.length];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-background">
        <div className="text-center space-y-3">
          <Loader className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading narrative branches...
          </p>
        </div>
      </div>
    );
  }

  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-background">
        <div className="text-center space-y-4">
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            No branches yet. Start a session to create narrative branches.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      {/* Graph Canvas */}
      <div className="flex-1 flex flex-col relative border-r border-primary/20">
        <div className="px-4 py-3 border-b border-primary/20 bg-black/60">
          <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
            // Story Branching Tree
          </h1>
          <p className="text-[9px] font-mono text-primary/30 mt-1">
            {snapshots.length} branch{snapshots.length !== 1 ? "es" : ""}
            {selectedNode && ` • Selected: ${selectedNode.branch_name}`}
          </p>
        </div>

        <div className="flex-1 overflow-hidden bg-black/40 relative" ref={containerRef}>
          <button
            onClick={fitToScreen}
            title="Fit to screen"
            className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 border border-primary/30 bg-black/60 text-primary/60 hover:text-primary hover:border-primary/60 font-mono text-[9px] tracking-widest uppercase transition-all backdrop-blur-sm"
          >
            <Maximize2 className="w-3 h-3" />
            Fit
          </button>
          <svg
            width="100%"
            height="100%"
            className="bg-gradient-to-b from-black/20 to-black/40"
            style={{ minHeight: "400px" }}
            viewBox={viewBox || undefined}
            preserveAspectRatio={viewBox ? "xMidYMid meet" : undefined}
          >
            {/* Edges (connections between parent and child snapshots) */}
            {snapshots.map((snapshot) => {
              if (!snapshot.parent_snapshot_id) return null;
              const parentPos = positions[snapshot.parent_snapshot_id];
              const childPos = positions[snapshot.id];
              if (!parentPos || !childPos) return null;

              return (
                <line
                  key={`edge-${snapshot.id}`}
                  x1={parentPos.x}
                  y1={parentPos.y}
                  x2={childPos.x}
                  y2={childPos.y}
                  stroke={snapshot.is_active ? "#51cf66" : "#74c0fc"}
                  strokeWidth={snapshot.is_active ? 2 : 1}
                  opacity={0.5}
                  strokeDasharray={snapshot.is_active ? "0" : "5,5"}
                />
              );
            })}

            {/* Nodes */}
            {snapshots.map((snapshot) => {
              const pos = positions[snapshot.id];
              if (!pos) return null;

              const isSelected = selectedNode?.id === snapshot.id;
              const nodeRadius = isSelected ? 28 : 20;
              const color = getNodeColor(snapshot);

              return (
                <g
                  key={snapshot.id}
                  onClick={() => handleNodeClick(snapshot)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Node circle */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={nodeRadius}
                    fill={color}
                    opacity={0.9}
                    className="transition-all hover:opacity-100"
                  />
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={nodeRadius}
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 1.5}
                    opacity={isSelected ? 1 : 0.5}
                  />

                  {/* Node label (first letter) */}
                  <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="font-mono text-[10px] font-bold fill-black pointer-events-none select-none"
                  >
                    {snapshot.branch_name[0].toUpperCase()}
                  </text>

                  {/* Active indicator */}
                  {snapshot.is_active && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={nodeRadius + 8}
                      fill="none"
                      stroke="#51cf66"
                      strokeWidth={1}
                      opacity={0.3}
                      className="animate-pulse"
                    />
                  )}

                  {/* Tooltip on hover */}
                  {isSelected && (
                    <g>
                      <rect
                        x={pos.x - 70}
                        y={pos.y - 60}
                        width="140"
                        height="50"
                        rx="4"
                        fill="hsl(220 20% 6%)"
                        stroke={color}
                        strokeWidth="1"
                        opacity="0.95"
                      />
                      <text
                        x={pos.x}
                        y={pos.y - 38}
                        textAnchor="middle"
                        className="font-mono text-[9px] font-semibold fill-current"
                        style={{ color: color }}
                      >
                        {snapshot.branch_name}
                      </text>
                      <text
                        x={pos.x}
                        y={pos.y - 22}
                        textAnchor="middle"
                        className="font-mono text-[8px] fill-current"
                        style={{ color: color, opacity: 0.7 }}
                      >
                        Depth: {snapshot.depth || 0}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Details Panel */}
      <AnimatePresence>
        {expandedDetails && selectedNode && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-80 border-l border-primary/20 bg-black/60 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-primary/20 flex items-center justify-between">
              <div>
                <h2 className="font-mono text-xs text-primary tracking-[0.2em] uppercase">
                  Branch Details
                </h2>
                <p className="text-[9px] font-mono text-primary/30 mt-1">{selectedNode.branch_name}</p>
              </div>
              <button
                onClick={() => {
                  setExpandedDetails(false);
                  setSelectedNode(null);
                }}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status */}
              <div>
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                  Status
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: selectedNode.is_active ? "#51cf66" : "#74c0fc" }}
                  />
                  <span className="text-[10px] font-mono text-primary/70">
                    {selectedNode.is_active ? "Active Timeline" : "Alternate Timeline"}
                  </span>
                </div>
              </div>

              {/* Decision Point */}
              {selectedNode.decision_point && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                    Decision Point
                  </p>
                  <p className="text-[10px] font-mono text-primary/80 leading-relaxed">
                    {selectedNode.decision_point}
                  </p>
                </div>
              )}

              {/* Depth */}
              <div>
                <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                  Depth
                </p>
                <p className="text-[10px] font-mono text-primary/70">{selectedNode.depth || 0} levels</p>
              </div>

              {/* Outcome Summary */}
              {selectedNode.outcome_summary && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                    Outcome Summary
                  </p>
                  <p className="text-[10px] font-mono text-primary/70 leading-relaxed line-clamp-4">
                    {selectedNode.outcome_summary}
                  </p>
                </div>
              )}

              {/* Political Outcome */}
              {selectedNode.political_outcome && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                    Political Changes
                  </p>
                  <p className="text-[10px] font-mono text-primary/70 leading-relaxed line-clamp-3">
                    {selectedNode.political_outcome}
                  </p>
                </div>
              )}

              {/* Key Events */}
              {selectedNode.key_events && selectedNode.key_events.length > 0 && (
                <div>
                  <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">
                    Key Events
                  </p>
                  <ul className="text-[9px] font-mono text-primary/70 space-y-1">
                    {selectedNode.key_events.slice(0, 3).map((event, idx) => (
                      <li key={idx} className="ml-2">• {event}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-primary/20 p-4 space-y-2">
              <button
                onClick={handleRestoreBranch}
                className="w-full py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all"
              >
                <ArrowRight className="w-3 h-3 inline mr-2" />
                Restore Branch
              </button>
              <button
                onClick={handleCreateBranch}
                className="w-full py-2 border border-primary/20 text-primary/60 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
              >
                <Plus className="w-3 h-3 inline mr-2" />
                Create Branch
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}