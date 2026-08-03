import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, GitBranch, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";

export default function WorldBranchingTreeView({
  sessionId,
  onSelectBranch,
  onCreateBranch,
}) {
  const [snapshots, setSnapshots] = useState([]);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionId) {
      loadSnapshots();
    }
  }, [sessionId]);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.WorldSnapshot.filter(
        { session_id: sessionId },
        "-created_date",
        100
      );
      setSnapshots(data || []);
    } catch (err) {
      console.error("Error loading snapshots:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (snapshotId) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(snapshotId)) {
      newExpanded.delete(snapshotId);
    } else {
      newExpanded.add(snapshotId);
    }
    setExpandedNodes(newExpanded);
  };

  // Build tree structure
  const buildTree = () => {
    const tree = {};
    const snapshotMap = {};

    snapshots.forEach(snap => {
      snapshotMap[snap.id] = snap;
      if (!snap.parent_snapshot_id) {
        tree[snap.id] = [];
      }
    });

    snapshots.forEach(snap => {
      if (snap.parent_snapshot_id && snapshotMap[snap.parent_snapshot_id]) {
        if (!tree[snap.parent_snapshot_id]) {
          tree[snap.parent_snapshot_id] = [];
        }
        tree[snap.parent_snapshot_id].push(snap.id);
      }
    });

    return tree;
  };

  const tree = buildTree();
  const rootNodes = snapshots.filter(s => !s.parent_snapshot_id);

  const renderNode = (snapshotId, depth = 0) => {
    const snapshot = snapshots.find(s => s.id === snapshotId);
    if (!snapshot) return null;

    const children = tree[snapshotId] || [];
    const isExpanded = expandedNodes.has(snapshotId);
    const isSelected = selectedSnapshot?.id === snapshotId;

    return (
      <div key={snapshotId} className="space-y-1">
        {/* Node */}
        <motion.div
          layout
          className={`flex items-center gap-1.5 p-2 border rounded cursor-pointer transition-all ${
            isSelected
              ? "border-primary/40 bg-primary/10"
              : "border-primary/15 bg-black/30 hover:border-primary/25"
          }`}
          style={{ marginLeft: `${depth * 16}px` }}
          onClick={() => {
            setSelectedSnapshot(snapshot);
            onSelectBranch(snapshot);
          }}
        >
          {children.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(snapshotId);
              }}
              className="flex-shrink-0 text-primary/40 hover:text-primary transition-colors"
            >
              <ChevronRight
                className={`w-4 h-4 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </button>
          )}

          {!children.length && (
            <div className="w-4 h-4 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] text-primary/80 tracking-wider uppercase truncate">
              {snapshot.branch_name}
            </p>
            <p className="text-[8px] text-primary/40 truncate">
              {snapshot.decision_point}
            </p>
          </div>

          {snapshot.is_active && (
            <span className="px-1.5 py-0.5 bg-green-400/10 border border-green-400/30 rounded text-[7px] font-mono text-green-400 flex-shrink-0">
              ACTIVE
            </span>
          )}
        </motion.div>

        {/* Children */}
        <AnimatePresence>
          {isExpanded && children.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-1"
            >
              {children.map(childId => renderNode(childId, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase animate-pulse">
          Loading timelines...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border border-primary/20 bg-primary/5 rounded">
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          🌳 Branching Timeline ({snapshots.length} variants)
        </span>
        <button
          onClick={() => onCreateBranch()}
          className="flex items-center gap-1.5 px-2 py-1 border border-primary/30 hover:border-primary/50 bg-primary/5 hover:bg-primary/10 text-primary/60 hover:text-primary font-mono text-[8px] tracking-widest uppercase transition-all"
        >
          <Plus className="w-3 h-3" />
          Create Branch
        </button>
      </div>

      {/* Tree */}
      <div className="border border-primary/15 bg-black/30 rounded p-3 max-h-96 overflow-y-auto space-y-1">
        {rootNodes.length === 0 ? (
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase text-center py-4">
            No timeline snapshots yet
          </p>
        ) : (
          rootNodes.map(root => renderNode(root.id))
        )}
      </div>

      {/* Selected Details */}
      {selectedSnapshot && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 border border-primary/20 bg-black/40 rounded space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-mono text-sm text-primary tracking-wider uppercase">
                {selectedSnapshot.branch_name}
              </h3>
              <p className="text-[9px] font-mono text-primary/50 mt-0.5">
                Decision: {selectedSnapshot.decision_point}
              </p>
            </div>
          </div>

          {selectedSnapshot.outcome_summary && (
            <div>
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                Outcome
              </p>
              <p className="text-[9px] font-mono text-primary/70">
                {selectedSnapshot.outcome_summary}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-[8px]">
            {selectedSnapshot.political_outcome && (
              <div className="p-2 bg-primary/5 border border-primary/15 rounded">
                <p className="font-mono text-primary/40 tracking-widest uppercase mb-0.5">
                  Political
                </p>
                <p className="text-primary/70 line-clamp-2">
                  {selectedSnapshot.political_outcome}
                </p>
              </div>
            )}

            {selectedSnapshot.environmental_outcome && (
              <div className="p-2 bg-primary/5 border border-primary/15 rounded">
                <p className="font-mono text-primary/40 tracking-widest uppercase mb-0.5">
                  Environmental
                </p>
                <p className="text-primary/70 line-clamp-2">
                  {selectedSnapshot.environmental_outcome}
                </p>
              </div>
            )}
          </div>

          {selectedSnapshot.key_events?.length > 0 && (
            <div>
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
                Key Events
              </p>
              <div className="space-y-0.5 text-[8px] text-primary/70">
                {selectedSnapshot.key_events.slice(0, 3).map((event, idx) => (
                  <div key={idx} className="flex gap-1">
                    <span className="flex-shrink-0">•</span>
                    <span className="line-clamp-1">{event}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}