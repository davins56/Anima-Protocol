import { useState } from "react";
import { X, Loader } from "lucide-react";
import { motion } from "framer-motion";

export default function CreateBranchModal({
  isOpen,
  onClose,
  onCreateBranch,
  loading,
}) {
  const [branchName, setBranchName] = useState("");
  const [decision, setDecision] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = () => {
    if (branchName.trim() && decision.trim()) {
      onCreateBranch({
        branch_name: branchName,
        decision_point: decision,
        outcome_summary: description,
      });
      setBranchName("");
      setDecision("");
      setDescription("");
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-2xl bg-background border border-primary/30 rounded-lg shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60">
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
            // Create Branch
          </h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-primary/30 hover:text-primary transition-colors disabled:opacity-50"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Timeline Name
            </label>
            <input
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="e.g., 'The Rebellion Path', 'The Peaceful Route'"
              className="w-full bg-black/40 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Pivotal Decision
            </label>
            <input
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              placeholder="What choice defines this branch?"
              className="w-full bg-black/40 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Branch Context (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is the premise of this alternate timeline?"
              rows={4}
              className="w-full bg-black/40 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors resize-none"
            />
          </div>

          <p className="text-[8px] font-mono text-primary/30 leading-relaxed">
            💾 This will save the current world state including faction status, character relationships, locations, and environmental conditions. You can continue playing in this branch and compare it to other timelines.
          </p>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-primary/20 bg-black/60">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!branchName.trim() || !decision.trim() || loading}
            className="flex-1 px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-3 h-3 animate-spin" />
                Creating Branch...
              </>
            ) : (
              "Create Branch"
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}