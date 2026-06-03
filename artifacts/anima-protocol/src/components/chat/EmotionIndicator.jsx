// @ts-check
import { motion } from "framer-motion";

const emotionConfig = {
  joyful: { color: "from-green-500 to-green-400", icon: "😊", label: "Joyful" },
  calm: { color: "from-blue-500 to-blue-400", icon: "😌", label: "Calm" },
  sad: { color: "from-cyan-500 to-cyan-400", icon: "😢", label: "Sad" },
  angry: { color: "from-red-500 to-red-400", icon: "😠", label: "Angry" },
  afraid: { color: "from-orange-500 to-orange-400", icon: "😨", label: "Afraid" },
  disgusted: { color: "from-purple-500 to-purple-400", icon: "🤢", label: "Disgusted" },
  surprised: { color: "from-yellow-500 to-yellow-400", icon: "😲", label: "Surprised" },
  hopeful: { color: "from-lime-500 to-lime-400", icon: "🤞", label: "Hopeful" },
  conflicted: { color: "from-pink-500 to-pink-400", icon: "😕", label: "Conflicted" },
  desperate: { color: "from-red-600 to-red-500", icon: "😫", label: "Desperate" },
};

/**
 * @param {{ emotion?: keyof typeof emotionConfig, intensity?: number, trigger?: string | null, compact?: boolean }} props
 */
export default function EmotionIndicator({ emotion, intensity = 50, trigger = null, compact = false }) {
  if (!emotion || !emotionConfig[emotion]) return null;

  const config = emotionConfig[emotion];

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-1.5 px-2 py-1 bg-black/40 border border-primary/20 rounded"
      >
        <span className="text-sm">{config.icon}</span>
        <span className="font-mono text-[9px] text-primary/70 tracking-wider uppercase">
          {config.label}
        </span>
        <div className="w-8 h-0.5 border border-primary/20 bg-primary/10">
          <motion.div
            className={`h-full bg-gradient-to-r ${config.color}`}
            initial={{ width: 0 }}
            animate={{ width: `${intensity}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`p-3 border border-primary/20 bg-gradient-to-br ${config.color} bg-opacity-10 rounded-lg`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{config.icon}</span>
        <div className="flex-1">
          <h4 className="font-mono text-sm tracking-wider uppercase text-primary">
            {config.label}
          </h4>
          <p className="text-[8px] font-mono text-primary/50 mt-0.5">Emotional State</p>
        </div>
      </div>

      {/* Intensity bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-mono text-primary/60">Intensity</span>
          <span className="text-[9px] font-mono text-primary/40">{intensity}%</span>
        </div>
        <div className="w-full h-1.5 border border-primary/20 bg-black/40 rounded-full overflow-hidden">
          <motion.div
            className={`h-full bg-gradient-to-r ${config.color}`}
            initial={{ width: 0 }}
            animate={{ width: `${intensity}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Trigger */}
      {trigger && (
        <div className="mt-2 pt-2 border-t border-primary/10">
          <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase mb-0.5">
            Trigger
          </p>
          <p className="text-[9px] font-mono text-primary/60 italic">{trigger}</p>
        </div>
      )}
    </motion.div>
  );
}