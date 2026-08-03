import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Brain, CheckCircle2, Zap } from 'lucide-react';

/**
 * Shows when the AI references prior memories or learns something new.
 * Appears temporarily after significant moments.
 */
export default function MemoryIndicator({ 
  type = 'recall',
  content = "Memory recorded",
  visible = true,
  autoHide = true,
  duration = 3000,
  onDismiss,
}) {
  // Auto-hide after duration (must be before early return)
  useEffect(() => {
    if (!autoHide || !visible) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [autoHide, duration, onDismiss, visible]);

  if (!visible) return null;

  const icons = {
    recall: Brain,
    learn: CheckCircle2,
    sync: Zap,
  };

  const colors = {
    recall: { icon: '#60A5FA', bg: 'rgba(96, 165, 250, 0.1)', border: '#60A5FA60' },
    learn: { icon: '#34D399', bg: 'rgba(52, 211, 153, 0.1)', border: '#34D39960' },
    sync: { icon: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)', border: '#F59E0B60' },
  };

  const typeText = {
    recall: 'Serenity remembered',
    learn: 'Learning recorded',
    sync: 'Resonance increased',
  };

  const Icon = icons[type] || Brain;
  const colorScheme = colors[type] || colors.recall;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      className="flex items-center gap-2.5 px-4 py-3 rounded-lg border font-mono text-sm"
      style={{
        backgroundColor: colorScheme.bg,
        borderColor: colorScheme.border,
        color: colorScheme.icon,
      }}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <div>
        <p className="font-semibold text-xs uppercase tracking-wider">{typeText[type]}</p>
        <p className="text-xs text-primary/70 mt-0.5">{content}</p>
      </div>
    </motion.div>
  );
}