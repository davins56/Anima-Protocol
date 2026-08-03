import { useState } from 'react';
import { Map, Users, Scroll, Calendar, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { motion } from 'framer-motion';

const IMPACT_CATEGORIES = {
  location: { icon: Map, label: 'Locations', color: 'text-blue-400' },
  relationship: { icon: Users, label: 'Relationships', color: 'text-pink-400' },
  lore: { icon: Scroll, label: 'Lore Events', color: 'text-purple-400' },
  time: { icon: Calendar, label: 'Calendar', color: 'text-amber-400' },
};

export default function WorldStateImpactViewer({ branch, compareWith = null }) {
  const [comparisonMode, setComparisonMode] = useState(false);

  if (!branch) {
    return (
      <div className="p-3 border border-purple-400/20 bg-purple-900/10 rounded text-center">
        <p className="text-[9px] font-mono text-purple-400/50 tracking-widest uppercase">
          Select a branch to view world state impact
        </p>
      </div>
    );
  }

  const impacts = branch.world_state_impacts || {};
  const hasComparison = comparisonMode && compareWith;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-purple-400/20 bg-purple-900/10 rounded overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-purple-400/15 bg-purple-900/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
          <span className="font-mono text-[9px] text-purple-400 tracking-widest uppercase">
            World State Impact
          </span>
        </div>
        {compareWith && (
          <button
            onClick={() => setComparisonMode(!comparisonMode)}
            className="text-[8px] font-mono px-1.5 py-0.5 border border-purple-400/30 text-purple-400/60 hover:text-purple-400 transition-colors rounded"
          >
            {comparisonMode ? 'Single' : 'Compare'}
          </button>
        )}
      </div>

      {/* Impact Grid */}
      <div className="p-3 space-y-3">
        {Object.entries(impacts).map(([category, items]) => {
          if (!items || items.length === 0) return null;
          
          const config = IMPACT_CATEGORIES[category] || { 
            icon: Scroll, 
            label: category, 
            color: 'text-primary/70' 
          };
          const Icon = config.icon;

          return (
            <div key={category} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                <h3 className={`text-[9px] font-mono tracking-widest uppercase ${config.color}`}>
                  {config.label}
                </h3>
                <span className="text-[7px] font-mono text-primary/30 ml-auto">
                  {items.length} change{items.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="space-y-1">
                {items.map((item, idx) => {
                  const compareItem = hasComparison && compareWith.world_state_impacts?.[category]?.[idx];
                  const isChanged = compareItem && compareItem !== item;

                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`px-2 py-1.5 border rounded text-[8px] font-mono leading-relaxed transition-all ${
                        isChanged
                          ? 'border-yellow-400/30 bg-yellow-400/5'
                          : 'border-primary/15 bg-black/30'
                      }`}
                    >
                      <div className="flex items-start gap-1.5">
                        <span className={`text-[8px] mt-0.5 flex-shrink-0 ${
                          category === 'relationship' && item.includes('+')
                            ? 'text-green-400'
                            : category === 'relationship' && item.includes('-')
                            ? 'text-red-400'
                            : 'text-primary/50'
                        }`}>
                          {category === 'relationship' && item.includes('+') ? '↑' : 
                           category === 'relationship' && item.includes('-') ? '↓' : '•'}
                        </span>
                        <span className="text-primary/80">{item}</span>
                      </div>

                      {isChanged && (
                        <div className="mt-1 ml-4 pt-1 border-t border-yellow-400/15 text-[7px] font-mono text-yellow-400/70">
                          <strong>vs.</strong> {compareItem}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {Object.values(impacts).every(v => !v || v.length === 0) && (
          <p className="text-center text-[9px] font-mono text-primary/30 py-4 tracking-widest uppercase">
            No world state changes predicted
          </p>
        )}
      </div>

      {/* Impact Summary */}
      {branch.impact_severity && (
        <div className="px-3 py-2 border-t border-purple-400/10 bg-black/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-mono text-purple-400/60 tracking-widest uppercase">Impact Severity</span>
            <div className="flex items-center gap-2">
              {branch.impact_severity === 'high' && (
                <TrendingUp className="w-3 h-3 text-red-400" />
              )}
              {branch.impact_severity === 'medium' && (
                <Minus className="w-3 h-3 text-yellow-400" />
              )}
              {branch.impact_severity === 'low' && (
                <TrendingDown className="w-3 h-3 text-green-400" />
              )}
              <span className={`text-[9px] font-mono font-semibold capitalize ${
                branch.impact_severity === 'high' ? 'text-red-400' :
                branch.impact_severity === 'medium' ? 'text-yellow-400' :
                'text-green-400'
              }`}>
                {branch.impact_severity}
              </span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}