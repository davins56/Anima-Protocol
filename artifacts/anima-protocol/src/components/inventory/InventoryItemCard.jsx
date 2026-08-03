import { useState } from "react";
import { Trash2, Edit2, Check, Copy, Zap } from "lucide-react";
import { motion } from "framer-motion";

const TYPE_COLORS = {
  gear: "border-cyan-400/30 bg-cyan-400/5 text-cyan-400",
  consumable: "border-green-400/30 bg-green-400/5 text-green-400",
  weapon: "border-red-400/30 bg-red-400/5 text-red-400",
  armor: "border-blue-400/30 bg-blue-400/5 text-blue-400",
  artifact: "border-yellow-400/30 bg-yellow-400/5 text-yellow-400",
  misc: "border-primary/20 bg-primary/5 text-primary/60",
};

const RARITY_COLORS = {
  common: "text-primary/40",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  legendary: "text-yellow-400",
};

const SLOT_LABELS = {
  none: "—",
  head: "👤 Head",
  chest: "🛡️ Chest",
  hands: "🤝 Hands",
  feet: "👟 Feet",
  weapon: "⚔️ Weapon",
  offhand: "🛡️ Offhand",
  accessory: "✨ Accessory",
};

export default function InventoryItemCard({
  item,
  onEquip,
  onUnequip,
  onDelete,
  onEdit,
  isLoading,
}) {
  const [copied, setCopied] = useState(false);
  const colorClass = TYPE_COLORS[item.type] || TYPE_COLORS.misc;

  const handleCopy = () => {
    const text = `${item.name} (${item.type})${item.quantity > 1 ? ` x${item.quantity}` : ""}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEquip = () => {
    if (item.equipped) {
      onUnequip?.(item.id);
    } else {
      onEquip?.(item.id);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`group relative p-4 border rounded transition-all hover:shadow-lg hover:shadow-primary/10 ${colorClass}`}
    >
      {/* Top row: Icon + Name + Quantity */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-mono text-sm font-semibold tracking-wide truncate">
              {item.name}
            </h3>
            {item.quantity > 1 && (
              <span className="font-mono text-[10px] opacity-60">×{item.quantity}</span>
            )}
          </div>
          {item.description && (
            <p className="text-[9px] opacity-60 mt-1 line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {/* Equipped badge */}
        {item.equipped && (
          <div className="flex-shrink-0 px-2 py-1 bg-primary/20 border border-primary/40 rounded text-[8px] font-mono tracking-widest uppercase text-primary">
            Equipped
          </div>
        )}
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-[9px] font-mono opacity-60">
        <span className="uppercase tracking-wider">{item.type}</span>
        {item.slot && item.slot !== "none" && (
          <>
            <span>·</span>
            <span>{SLOT_LABELS[item.slot] || item.slot}</span>
          </>
        )}
        {item.rarity && item.rarity !== "common" && (
          <>
            <span>·</span>
            <span className={RARITY_COLORS[item.rarity] || "text-primary/40"}>
              {item.rarity}
            </span>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Equip button */}
        {item.slot && item.slot !== "none" && (
          <button
            onClick={handleEquip}
            disabled={isLoading}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 border text-[9px] font-mono tracking-widest uppercase transition-all disabled:opacity-50 ${
              item.equipped
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                : "border-primary/15 text-primary/40 hover:text-primary/70 hover:border-primary/25"
            }`}
            title={item.equipped ? "Unequip" : "Equip"}
          >
            <Check className="w-3 h-3" />
            <span className="hidden sm:inline">{item.equipped ? "Unequip" : "Equip"}</span>
          </button>
        )}

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 border border-primary/15 text-primary/40 hover:text-primary/70 hover:border-primary/25 text-[9px] font-mono tracking-widest uppercase transition-all"
          title="Copy to clipboard"
        >
          {copied ? (
            <span className="text-green-400">✓</span>
          ) : (
            <Copy className="w-3 h-3" />
          )}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
        </button>

        {/* Edit button */}
        <button
          onClick={() => onEdit?.(item)}
          disabled={isLoading}
          className="flex items-center justify-center px-2.5 py-1.5 border border-primary/15 text-primary/40 hover:text-primary/70 hover:border-primary/25 text-[9px] font-mono transition-all disabled:opacity-50"
          title="Edit item"
        >
          <Edit2 className="w-3 h-3" />
        </button>

        {/* Delete button */}
        <button
          onClick={() => onDelete?.(item.id)}
          disabled={isLoading}
          className="flex items-center justify-center px-2.5 py-1.5 border border-red-900/20 text-red-900/40 hover:text-red-400 hover:border-red-400/40 text-[9px] font-mono transition-all disabled:opacity-50"
          title="Delete item"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/40 rounded flex items-center justify-center">
          <Zap className="w-4 h-4 text-primary animate-pulse" />
        </div>
      )}
    </motion.div>
  );
}