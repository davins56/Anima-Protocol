import { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, ChevronRight, GitBranch, RotateCcw, Copy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function NarrativeFlowchart({ sessionId, onRestore, onFork }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [expandedBranches, setExpandedBranches] = useState(new Set());

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
        200
      );
      setSnapshots(data || []);
    } catch (err) {
      console.error("Error loading snapshots:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleBranch = (id) => {
    const newExpanded = new Set(expandedBranches);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedBranches(newExpanded);
  };

  const getChildSnapshots = (parentId) => {
    return snapshots.filter((s) => s.parent_snapshot_id === parentId);
  };

  const getRootSnapshots = () => {
    return snapshots.filter((s) => !s.parent_snapshot_id);
  };

  const renderBranchNode = (snapshot, depth = 0) => {
    const children = getChildSnapshots(snapshot.id);
    const isExpanded = expandedBranches.has(snapshot.id);

    return (
      <div key={snapshot.id} style={{ marginLeft: `${depth * 20}px` }} className="space-y-1">
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="group"
        >
          <button
            onClick={() => {
              setSelectedSnapshot(snapshot);
              if (children.length > 0) {
                toggleBranch(snapshot.id);
              }
            }}
            className={`w-full flex items-start gap-2 p-2.5 border rounded transition-all text-left ${
              selectedSnapshot?.id === snapshot.id
                ? "border-primary/60 bg-primary/10"
                : "border-primary/15 bg-black/30 hover:border-primary/30 hover:bg-primary/5"
            }`}
          >
            {children.length > 0 && (
              <ChevronRight
                className={`w-3.5 h-3.5 text-primary/60 flex-shrink-0 mt-1 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            )}
            {children.length === 0 && <div className="w-3.5" />}

            <div className="flex-1 min-w-0">
              <div className="font-mono text-[9px] text-primary/80 tracking-wider uppercase truncate">
                {snapshot.branch_name}
              </div>
              <div className="text-[8px] font-mono text-primary/40 mt-0.5 line-clamp-1">
                {snapshot.decision_point}
              </div>
              <div className="text-[7px] font-mono text-primary/30 mt-1">
                Depth: {snapshot.depth} • Index: {snapshot.message_index}
              </div>
            </div>

            <GitBranch className="w-3 h-3 text-primary/40 flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          <AnimatePresence>
            {isExpanded && children.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-1 mt-1"
              >
                {children.map((child) => renderBranchNode(child, depth + 1))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <Loader className="w-5 h-5 text-primary/60 animate-spin mx-auto" />
          <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            Loading narrative tree...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Tree */}
      <div className="lg:col-span-1 border border-primary/20 bg-black/30 rounded p-4 max-h-96 overflow-y-auto space-y-2">
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-3">
          Narrative Tree
        </p>
        {snapshots.length === 0 ? (
          <p className="text-[9px] font-mono text-primary/20">No branches yet</p>
        ) : (
          getRootSnapshots().map((root) => renderBranchNode(root))
        )}
      </div>

      {/* Details */}
      {selectedSnapshot ? (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:col-span-2 border border-primary/20 bg-black/30 rounded p-4 space-y-4"
        >
          <div>
            <h3 className="font-mono text-sm text-primary tracking-widest uppercase mb-2">
              {selectedSnapshot.branch_name}
            </h3>
            <div className="space-y-2">
              <div className="text-[9px] font-mono text-primary/60">
                <span className="text-primary/40">Decision Point:</span> {selectedSnapshot.decision_point}
              </div>
              {selectedSnapshot.outcome_summary && (
                <div className="text-[9px] font-mono text-primary/60 p-2 bg-primary/5 border border-primary/10 rounded">
                  <span className="text-primary/40 block mb-1">Outcome:</span>
                  {selectedSnapshot.outcome_summary}
                </div>
              )}
              {selectedSnapshot.political_outcome && (
                <div className="text-[9px] font-mono text-primary/60 p-2 bg-primary/5 border border-primary/10 rounded">
                  <span className="text-primary/40 block mb-1">Political Evolution:</span>
                  {selectedSnapshot.political_outcome}
                </div>
              )}
              {selectedSnapshot.environmental_outcome && (
                <div className="text-[9px] font-mono text-primary/60 p-2 bg-primary/5 border border-primary/10 rounded">
                  <span className="text-primary/40 block mb-1">Environmental Changes:</span>
                  {selectedSnapshot.environmental_outcome}
                </div>
              )}
              {selectedSnapshot.key_events?.length > 0 && (
                <div className="text-[9px] font-mono text-primary/60">
                  <span className="text-primary/40 block mb-1">Key Events:</span>
                  <ul className="ml-4 space-y-0.5">
                    {selectedSnapshot.key_events.map((evt, idx) => (
                      <li key={idx} className="list-disc">{evt}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t border-primary/10">
            <button
              onClick={() => onRestore?.(selectedSnapshot)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all font-mono text-[9px] tracking-widest uppercase"
            >
              <RotateCcw className="w-3 h-3" />
              Restore
            </button>
            <button
              onClick={() => onFork?.(selectedSnapshot)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary/5 border border-primary/20 text-primary/60 hover:text-primary hover:bg-primary/10 transition-all font-mono text-[9px] tracking-widest uppercase"
            >
              <Copy className="w-3 h-3" />
              Fork
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="lg:col-span-2 border border-primary/20 bg-black/30 rounded p-4 flex items-center justify-center text-center text-primary/40 font-mono text-[9px] tracking-widest uppercase">
          Select a branch to view details
        </div>
      )}
    </div>
  );
}