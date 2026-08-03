import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { GitBranch, Loader, Sparkles, X } from "lucide-react";

export default function WhatIfCreator({ session, snapshots, fromSnapshot, onCreated, onCancel }) {
  const [branchName, setBranchName] = useState("");
  const [decisionPoint, setDecisionPoint] = useState(fromSnapshot?.decision_point || "");
  const [outcomeSummary, setOutcomeSummary] = useState("");
  const [whatIfPrompt, setWhatIfPrompt] = useState("");
  const [parentSnapshotId, setParentSnapshotId] = useState(fromSnapshot?.id || "");
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (!whatIfPrompt.trim()) return;
    setGenerating(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a creative narrative assistant helping design a "what-if" scenario for an interactive story.

Session context: "${session.title || "Story Session"}"
What-if premise: "${whatIfPrompt}"
${fromSnapshot ? `Branching from: "${fromSnapshot.branch_name}" (Decision: ${fromSnapshot.decision_point})` : ""}

Generate a compelling branch name (2-4 words), a clear decision point (1-2 sentences describing the pivotal moment), and an intriguing outcome summary (2-3 sentences hinting at what changes in this timeline).

Respond in JSON with keys: branch_name, decision_point, outcome_summary`,
        response_json_schema: {
          type: "object",
          properties: {
            branch_name: { type: "string" },
            decision_point: { type: "string" },
            outcome_summary: { type: "string" },
          },
        },
      });
      if (result?.branch_name) setBranchName(result.branch_name);
      if (result?.decision_point) setDecisionPoint(result.decision_point);
      if (result?.outcome_summary) setOutcomeSummary(result.outcome_summary);
    } catch (err) {
      setError("Failed to generate scenario ideas.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!branchName.trim() || !decisionPoint.trim()) {
      setError("Branch name and decision point are required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await base44.functions.invoke("createWorldBranch", {
        session_id: session.id,
        branch_name: branchName.trim(),
        decision_point: decisionPoint.trim(),
        outcome_summary: outcomeSummary.trim(),
        parent_snapshot_id: parentSnapshotId || null,
      });
      onCreated();
    } catch (err) {
      setError(err?.message || "Failed to create scenario.");
      setCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-2xl mx-auto w-full"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-primary tracking-[0.2em] uppercase text-sm flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Create What-If Scenario
          </h2>
          <p className="text-[9px] font-mono text-primary/40 mt-1 tracking-widest">
            {fromSnapshot ? `Branching from: ${fromSnapshot.branch_name}` : `New timeline for: ${session.title || "Session"}`}
          </p>
        </div>
        <button onClick={onCancel} className="text-primary/30 hover:text-primary transition-colors flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* AI Generator */}
      <div className="border border-purple-400/30 bg-purple-400/5 rounded p-4 space-y-3">
        <p className="font-mono text-[9px] text-purple-400 tracking-widest uppercase flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          AI Scenario Generator
        </p>
        <div className="flex gap-2">
          <input
            value={whatIfPrompt}
            onChange={e => setWhatIfPrompt(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleGenerate()}
            placeholder='e.g. "What if the hero chose to betray the guild?"'
            className="flex-1 bg-black/40 border border-purple-400/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-2 focus:outline-none focus:border-purple-400/40 transition-colors"
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !whatIfPrompt.trim()}
            className="px-3 py-2 bg-purple-600/20 border border-purple-400/40 text-purple-400 hover:bg-purple-600/30 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center gap-1.5"
          >
            {generating ? <Loader className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generate
          </button>
        </div>
        <p className="text-[8px] font-mono text-purple-400/40">Describe your what-if premise and AI will fill in the details</p>
      </div>

      {/* Parent Snapshot */}
      {snapshots.length > 0 && (
        <div className="space-y-1.5">
          <label className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Branch From (optional)</label>
          <select
            value={parentSnapshotId}
            onChange={e => setParentSnapshotId(e.target.value)}
            className="w-full bg-black/60 border border-primary/20 text-primary/80 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="">Root (start fresh alternative)</option>
            {snapshots.map(snap => (
              <option key={snap.id} value={snap.id}>
                {snap.branch_name} {snap.is_active ? "(active)" : ""}
              </option>
            ))}
          </select>
          <p className="text-[8px] font-mono text-primary/25">Which existing timeline does this branch from?</p>
        </div>
      )}

      {/* Branch Name */}
      <div className="space-y-1.5">
        <label className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Scenario Name *</label>
        <input
          value={branchName}
          onChange={e => setBranchName(e.target.value)}
          placeholder="e.g. The Rebel Path, Dark Alliance, Peace Treaty"
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
        />
      </div>

      {/* Decision Point */}
      <div className="space-y-1.5">
        <label className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Pivotal Decision *</label>
        <textarea
          value={decisionPoint}
          onChange={e => setDecisionPoint(e.target.value)}
          placeholder="What key decision or event creates this alternate timeline? e.g. 'The hero chose to spare the villain instead of fighting them.'"
          rows={3}
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors resize-none"
        />
      </div>

      {/* Outcome Summary */}
      <div className="space-y-1.5">
        <label className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Outcome Summary (optional)</label>
        <textarea
          value={outcomeSummary}
          onChange={e => setOutcomeSummary(e.target.value)}
          placeholder="How does this timeline unfold differently? What changes as a result?"
          rows={3}
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-2.5 focus:outline-none focus:border-primary/50 transition-colors resize-none"
        />
      </div>

      {error && (
        <p className="font-mono text-[9px] text-red-400 tracking-widest">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !branchName.trim() || !decisionPoint.trim()}
          className="flex-1 py-2.5 bg-primary/10 border border-primary/50 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2"
        >
          {creating ? <Loader className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
          Create Scenario
        </button>
      </div>
    </motion.div>
  );
}