import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Mobile-only Drawer for select menus on small screens.
 * Shows as normal select on desktop/tablet.
 */
export default function MobileDrawerSelect({ label, value, onChange, options, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = options.find(o => o.value === value)?.label || label;

  return (
    <>
      {/* Mobile: Drawer Button */}
      <div className="sm:hidden">
        <button
          onClick={() => setIsOpen(true)}
          className={`w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 text-left flex items-center justify-between hover:border-primary/50 transition-colors ${className}`}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="w-4 h-4 flex-shrink-0 ml-2" />
        </button>

        {/* Drawer Modal */}
        <AnimatePresence>
          {isOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsOpen(false)}
                className="fixed inset-0 bg-black/60 z-40"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-primary/20 rounded-t-2xl"
                style={{ maxHeight: '60vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
              >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-primary/10">
                  <span className="font-mono text-xs text-primary/60 tracking-widest uppercase">{label}</span>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 text-primary/40 hover:text-primary transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Options */}
                <div className="overflow-y-auto" style={{ maxHeight: 'calc(60vh - 60px)' }}>
                  {options.map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={`w-full px-4 py-3.5 text-left font-mono text-sm transition-colors border-b border-primary/5 min-h-[44px] flex items-center ${
                        value === option.value
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-primary/70 hover:bg-primary/5'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Desktop: Native Select */}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`hidden sm:block bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors ${className}`}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  );
}