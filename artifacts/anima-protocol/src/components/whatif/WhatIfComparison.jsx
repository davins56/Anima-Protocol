import { Layers, X, Check } from "lucide-react";
import { motion } from "framer-motion";

const Field = ({ label, value, highlight }) => (
  <div className={`p-3 rounded border transition-all ${highlight ? "border-primary/30 bg-primary/5" : "border-primary/10 bg-black/30"}`}>
    <p className="font-mono text-[7px] text-primary/40 tracking-widest uppercase mb-1">{label}</p>
    <p className="font-mono text-[9px] text-primary/80 leading-relaxed">{value || <span className="text-primary/20 italic">—</span>}</p>
  </div>
);

export default function WhatIfComparison({ snapshots, selectedSnapshots, onToggleSelect, onClearSelection }) {
  const [a, b] = selectedSnapshots;

  const fields = [
    { key: "branch_name", label: "Scenario Name" },
    { key: "decision_point", label: "Pivotal Decision" },
    { key: "outcome_summary", label: "Outcome Summary" },
    { key: "political_outcome", label: "Political Landscape" },
    { key: "environmental_outcome", label: "Environment" },
    { key: "depth", label: "Branch Depth" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-primary tracking-[0.2em] uppercase text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Timeline Comparison
          </h2>
          <p className="text-[9px] font-mono text-primary/30 mt-0.5">Select 2 scenarios to compare side-by-side</p>
        </div>
        {selectedSnapshots.length > 0 && (
          <button onClick={onClearSelection} className="text-primary/40 hover:text-primary font-mono text-[8px] tracking-widest uppercase flex items-center gap-1">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Selection Grid */}
      <div>
        <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">Choose Scenarios to Compare</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {snapshots.map(snap => {
            const isSelected = selectedSnapshots.find(s => s.id === snap.id);
            const selIdx = selectedSnapshots.findIndex(s => s.id === snap.id);
            return (
              <button
                key={snap.id}
                onClick={() => onToggleSelect(snap)}
                className={`p-2.5 border text-left transition-all relative ${
                  isSelected
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-primary/15 bg-black/40 text-primary/50 hover:border-primary/30 hover:text-primary/70"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                    <span className="font-mono text-[8px] text-background font-bold">{selIdx + 1}</span>
                  </div>
                )}
                <p className="font-mono text-[9px] tracking-wider uppercase truncate pr-5">{snap.branch_name}</p>
                {snap.is_active && <p className="font-mono text-[7px] text-primary/40 mt-0.5">ACTIVE</p>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Comparison Table */}
      {a && b ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Column Headers */}
          <div className="grid grid-cols-2 gap-4">
            {[a, b].map((snap, idx) => (
              <div key={snap.id} className={`p-3 border rounded ${idx === 0 ? "border-primary/40 bg-primary/5" : "border-purple-400/40 bg-purple-400/5"}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${snap.is_active ? "bg-primary animate-pulse" : "bg-green-400"}`} />
                  <p className={`font-mono text-xs tracking-wider uppercase ${idx === 0 ? "text-primary" : "text-purple-400"}`}>
                    {snap.branch_name}
                  </p>
                </div>
                <p className="font-mono text-[8px] text-primary/30 mt-1">{snap.is_active ? "Currently Active" : "Alternate Timeline"} · Depth {snap.depth || 0}</p>
              </div>
            ))}
          </div>

          {/* Field Comparisons */}
          {fields.map(({ key, label }) => (
            <div key={key}>
              <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">{label}</p>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label={a.branch_name}
                  value={key === "depth" ? `Level ${a[key] || 0}` : a[key]}
                  highlight={a[key] !== b[key]}
                />
                <Field
                  label={b.branch_name}
                  value={key === "depth" ? `Level ${b[key] || 0}` : b[key]}
                  highlight={a[key] !== b[key]}
                />
              </div>
            </div>
          ))}

          {/* Key Events */}
          <div>
            <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">Key Events</p>
            <div className="grid grid-cols-2 gap-4">
              {[a, b].map((snap, idx) => (
                <div key={snap.id} className="p-3 rounded border border-primary/10 bg-black/30 space-y-1">
                  {snap.key_events?.length > 0 ? snap.key_events.slice(0, 5).map((ev, i) => (
                    <p key={i} className="font-mono text-[8px] text-primary/60 flex items-start gap-1.5">
                      <span className="text-primary/30 flex-shrink-0">•</span> {ev}
                    </p>
                  )) : (
                    <p className="font-mono text-[8px] text-primary/20 italic">No key events recorded</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Relationship Snapshots */}
          {(a.relationship_snapshots?.length > 0 || b.relationship_snapshots?.length > 0) && (
            <div>
              <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">Character Relationships</p>
              <div className="grid grid-cols-2 gap-4">
                {[a, b].map((snap, idx) => (
                  <div key={snap.id} className="p-3 rounded border border-primary/10 bg-black/30 space-y-1.5">
                    {snap.relationship_snapshots?.slice(0, 4).map((rel, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <p className="font-mono text-[8px] text-primary/60 truncate">{rel.character_id?.slice(0, 8)}...</p>
                        <div className="flex items-center gap-1">
                          <div className="w-12 h-1 bg-primary/10 rounded overflow-hidden">
                            <div
                              className="h-full bg-primary rounded"
                              style={{ width: `${Math.max(0, Math.min(100, (rel.score + 100) / 2))}%` }}
                            />
                          </div>
                          <p className="font-mono text-[7px] text-primary/40">{rel.tier}</p>
                        </div>
                      </div>
                    )) || <p className="font-mono text-[8px] text-primary/20 italic">No relationships</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      ) : (
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-2">
            <Layers className="w-8 h-8 text-primary/15 mx-auto" />
            <p className="font-mono text-[9px] text-primary/25 tracking-widest uppercase">
              Select 2 scenarios above to compare timelines
            </p>
          </div>
        </div>
      )}
    </div>
  );
}