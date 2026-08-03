import { useState } from 'react';
import { Zap, Heart, Activity, Database, Brain, AlertCircle, CheckCircle2, Loader } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';

const repairTypes = [
  { id: 'memory', label: 'Memory Recovery', icon: Brain, description: 'Restore corrupted memories' },
  { id: 'state', label: 'State Reset', icon: Activity, description: 'Clear stuck emotional states' },
  { id: 'interactions', label: 'Interaction Validation', icon: Heart, description: 'Validate recent exchanges' },
  { id: 'health', label: 'Health Check', icon: Zap, description: 'Diagnostic scan' },
  { id: 'database', label: 'Database Repair', icon: Database, description: 'Data consistency check' },
];

export default function AnimaSelfRepairPanel({ animaId, onRepairComplete }) {
  const [loading, setLoading] = useState(false);
  const [selectedRepairs, setSelectedRepairs] = useState(new Set(['memory', 'state', 'interactions', 'health', 'database']));
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const toggleRepair = (repairId) => {
    const newSet = new Set(selectedRepairs);
    if (newSet.has(repairId)) {
      newSet.delete(repairId);
    } else {
      newSet.add(repairId);
    }
    setSelectedRepairs(newSet);
  };

  const runRepair = async () => {
    if (selectedRepairs.size === 0) return;
    
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const repairType = selectedRepairs.size === 5 ? 'full' : Array.from(selectedRepairs)[0];
      
      const response = await base44.functions.invoke('animaSelfRepair', {
        anima_id: animaId,
        repair_type: repairType,
      });

      setResults(response?.data);
      if (onRepairComplete) {
        onRepairComplete(response?.data);
      }
    } catch (err) {
      setError(err.message);
      console.error('Self-repair error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-purple-400/30 bg-purple-950/20 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-purple-400/20 bg-purple-900/30">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-purple-400" />
          <span className="font-mono text-xs text-purple-400 tracking-widest uppercase">Self-Repair System</span>
        </div>
        <p className="text-[9px] font-mono text-purple-400/60">Run diagnostic and recovery procedures</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Repair Type Selection */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {repairTypes.map((repair) => {
            const Icon = repair.icon;
            const isSelected = selectedRepairs.has(repair.id);
            
            return (
              <button
                key={repair.id}
                onClick={() => toggleRepair(repair.id)}
                disabled={loading}
                className={`p-2.5 rounded border text-left transition-all text-[8px] font-mono ${
                  isSelected
                    ? 'border-purple-400/60 bg-purple-600/30 text-purple-300'
                    : 'border-purple-400/20 bg-black/40 text-purple-400/70 hover:border-purple-400/40'
                } disabled:opacity-50`}
              >
                <Icon className="w-3 h-3 mb-1" />
                <div className="font-mono text-[7px] tracking-widest uppercase">
                  {repair.label}
                </div>
              </button>
            );
          })}
        </div>

        {/* Run Button */}
        <button
          onClick={runRepair}
          disabled={loading || selectedRepairs.size === 0}
          className="w-full py-2.5 border border-purple-400/50 bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2">
              <Loader className="w-3 h-3 animate-spin" />
              Running repairs...
            </div>
          ) : (
            `Run ${selectedRepairs.size === 5 ? 'Full' : 'Selected'} Repair`
          )}
        </button>

        {/* Error Display */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 border border-red-400/30 bg-red-400/10 rounded text-[9px] font-mono text-red-400 space-y-1"
          >
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3" />
              <span className="tracking-widest uppercase">Error</span>
            </div>
            <p>{error}</p>
          </motion.div>
        )}

        {/* Results Display */}
        <AnimatePresence>
          {results && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 border border-purple-400/30 bg-purple-400/10 rounded space-y-3"
            >
              {/* Health Score */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[8px] font-mono text-purple-400/60 tracking-widest uppercase">
                    Health Score
                  </span>
                  <span className="text-[9px] font-mono text-purple-300">
                    {results.health_score}/100
                  </span>
                </div>
                <div className="w-full h-1.5 bg-black/40 rounded overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${results.health_score}%` }}
                    className={`h-full ${
                      results.health_score >= 80
                        ? 'bg-green-500'
                        : results.health_score >= 60
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                    }`}
                  />
                </div>
              </div>

              {/* Repairs Completed */}
              <div>
                <p className="text-[8px] font-mono text-purple-400/60 tracking-widest uppercase mb-1.5">
                  Repairs Completed
                </p>
                <div className="space-y-1">
                  {results.repairs_completed.map((repair) => (
                    <div key={repair} className="flex items-center gap-1.5 text-[8px] font-mono text-purple-300">
                      <CheckCircle2 className="w-2.5 h-2.5 text-green-400" />
                      <span className="capitalize">{repair.replace('_', ' ')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Issues Found */}
              {results.issues_found.length > 0 && (
                <div>
                  <p className="text-[8px] font-mono text-purple-400/60 tracking-widest uppercase mb-1.5">
                    Issues Found: {results.issues_found.length}
                  </p>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {results.issues_found.map((issue, idx) => (
                      <p key={idx} className="text-[7px] font-mono text-purple-300/70 leading-tight">
                        • {issue}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary */}
              <p className="text-[8px] font-mono text-purple-400/80 italic border-t border-purple-400/20 pt-2">
                {results.summary}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}