import { useState } from "react";
import { ChevronRight, GitBranch, MapPin, Loader } from "lucide-react";
import { motion } from "framer-motion";

export default function NarrativeBranchMap({ branches, decisionPoints, loading }) {
  const [expandedNodes, setExpandedNodes] = useState(new Set(['root']));
  const [selectedPath, setSelectedPath] = useState(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Mapping narrative branches...
          </p>
        </div>
      </div>
    );
  }

  if (!branches || !branches.structure) {
    return (
      <div className="text-center py-8">
        <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
          No branching data yet
        </p>
      </div>
    );
  }

  const toggleNode = (nodeId) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const renderNode = (nodeId, depth = 0) => {
    const node = branches.structure[nodeId];
    if (!node) return null;

    const isExpanded = expandedNodes.has(nodeId);
    const hasChildren = node.children && node.children.length > 0;
    const isCurrentPath = branches.currentPath.includes(nodeId);
    const isDecisionPoint = decisionPoints.some(d => d.messageIndex === node.order);

    return (
      <motion.div
        key={nodeId}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-1"
      >
        <div
          style={{ paddingLeft: `${depth * 20}px` }}
          className="flex items-center gap-2"
        >
          {hasChildren && (
            <button
              onClick={() => toggleNode(nodeId)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-primary/40 hover:text-primary/70 transition-colors"
            >
              <ChevronRight
                className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              />
            </button>
          )}
          {!hasChildren && <div className="w-5" />}

          <button
            onClick={() => setSelectedPath(nodeId)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all text-left flex-1 ${
              selectedPath === nodeId
                ? "border-primary/60 bg-primary/10 text-primary"
                : isCurrentPath
                ? "border-cyan-400/40 bg-cyan-400/5 text-cyan-400 hover:border-cyan-400/60"
                : "border-primary/15 text-primary/60 hover:text-primary/80 hover:border-primary/30"
            }`}
          >
            <div className="flex items-center gap-1.5">
              {isDecisionPoint && (
                <GitBranch className="w-3 h-3 flex-shrink-0 text-yellow-400" />
              )}
              {!isDecisionPoint && isCurrentPath && (
                <div className="w-3 h-3 rounded-full bg-cyan-400/60 flex-shrink-0" />
              )}
              {!isDecisionPoint && !isCurrentPath && (
                <div className="w-3 h-3 rounded-full bg-primary/20 flex-shrink-0" />
              )}
            </div>
            <span className="font-mono text-[9px] tracking-wider uppercase truncate">
              {node.title}
            </span>
            {isCurrentPath && (
              <span className="text-[7px] font-mono text-cyan-400/60 flex-shrink-0 tracking-widest">
                CURRENT
              </span>
            )}
          </button>
        </div>

        {isExpanded && hasChildren && (
          <div>
            {node.children.map(childId => renderNode(childId, depth + 1))}
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Decision Points Summary */}
      <div className="p-4 border border-primary/15 bg-primary/5 rounded">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="w-4 h-4 text-yellow-400" />
          <h3 className="font-mono text-xs tracking-[0.15em] uppercase text-primary/70">
            Decision Points: {decisionPoints.length}
          </h3>
        </div>
        <p className="text-[9px] font-mono text-primary/50">
          {branches.totalDecisions} key choices shape this narrative
        </p>
      </div>

      {/* Branch Map */}
      <div className="p-4 border border-primary/15 bg-black/40 rounded space-y-2 max-h-96 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-primary/10">
          <MapPin className="w-4 h-4 text-primary/60" />
          <p className="font-mono text-[9px] text-primary/50 tracking-widest uppercase">
            Narrative Tree
          </p>
        </div>

        {renderNode('root')}
      </div>

      {/* Selected Node Details */}
      {selectedPath && branches.structure[selectedPath] && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 border border-cyan-400/30 bg-cyan-400/5 rounded"
        >
          <h4 className="font-mono text-xs text-cyan-400 tracking-wider uppercase mb-2">
            {branches.structure[selectedPath].title}
          </h4>
          <p className="text-[9px] font-mono text-cyan-400/70 leading-relaxed">
            {decisionPoints.find(d => d.messageIndex === branches.structure[selectedPath].order)
              ? `Decision Point: ${decisionPoints.find(d => d.messageIndex === branches.structure[selectedPath].order)?.content}`
              : "Part of the main narrative path"}
          </p>
        </motion.div>
      )}
    </div>
  );
}