// @ts-check
import { MapPin, Smile, Zap } from "lucide-react";
import { motion } from "framer-motion";

const EVENT_STYLES = {
  emotion: {
    icon: Smile,
    color: "text-pink-400",
    border: "border-pink-400/20",
    bg: "bg-pink-400/5",
    label: "EMOTION SHIFT",
  },
  location: {
    icon: MapPin,
    color: "text-green-400",
    border: "border-green-400/20",
    bg: "bg-green-400/5",
    label: "LOCATION",
  },
  default: {
    icon: Zap,
    color: "text-yellow-400",
    border: "border-yellow-400/20",
    bg: "bg-yellow-400/5",
    label: "EVENT",
  },
};

/**
 * @param {{ message?: any }} props
 */
export default function EventBubble({ message }) {
  const kind = message.event_type || "default";
  const style = EVENT_STYLES[/** @type {keyof typeof EVENT_STYLES} */ (kind)] || EVENT_STYLES.default;
  const Icon = style.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="flex items-center justify-center my-2"
    >
      <div className={`flex items-center gap-2.5 px-4 py-1.5 border ${style.border} ${style.bg} max-w-[80%]`}>
        <Icon className={`w-3 h-3 ${style.color} flex-shrink-0`} />
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-mono text-[8px] tracking-[0.3em] uppercase ${style.color} flex-shrink-0`}>
            {style.label}
          </span>
          <span className="font-mono text-[10px] text-primary/60 tracking-wider truncate">
            {message.content}
          </span>
        </div>
        {message.character_name && message.character_name !== "Narrator" && (
          <span className="font-mono text-[8px] text-primary/30 tracking-widest uppercase flex-shrink-0">
            [{message.character_name}]
          </span>
        )}
      </div>
    </motion.div>
  );
}