import { useState } from "react";
import { Shield, Sword, Zap, Star, Package, Trash2, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const TYPE_ICONS = {
  gear: Shield,
  consumable: Zap,
  weapon: Sword,
  armor: Shield,
  artifact: Star,
  misc: Package,
};

const TYPE_COLORS = {
  gear: "border-cyan-400/40 bg-cyan-400/5 text-cyan-400",
  consumable: "border-green-400/40 bg-green-400/5 text-green-400",
  weapon: "border-red-400/40 bg-red-400/5 text-red-400",
  armor: "border-blue-400/40 bg-blue-400/5 text-blue-400",
  artifact: "border-yellow-400/40 bg-yellow-400/5 text-yellow-400",
  misc: "border-primary/30 bg-primary/5 text-primary",
};

const RARITY_COLORS = {
  common: "text-primary/40",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  legendary: "text-yellow-400",
};

export default function InventoryGrid({ items, onEquipToggle, onDelete, onSelect, selectedId }) {
  const [expandedId, setExpandedId] = useState(null);

  const equippedItems = items.filter(i => i.equipped);
  const unequippedItems = items.filter(i => !i.equipped);

  const renderItemCard = (item) => {
    const Icon = TYPE_ICONS[item.type] || Package;
    const colorClass = TYPE_COLORS[item.type] || TYPE_COLORS.misc;
    const isSelected = selectedId === item.id;
    const isExpanded = expandedId === item.id;

    return (
      <motion.div
        key={item.id}
        layout
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        onClick={() => setExpandedId(isExpanded ? null : item.id)}
        className={`p-3 border cursor-pointer transition-all ${colorClass} ${
          isSelected ? "ring-2 ring-primary" : ""
        }`}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4" />
            <span className="font-mono text-xs tracking-wider uppercase truncate">
              {item.name}
            </span>
          </div>
          {item.quantity > 1 && (
            <span className="text-[8px] font-mono text-current/60">×{item.quantity}</span>
          )}
        </div>

        <div className="flex items-center gap-2 mb-2 text-[9px]">
          <span className={`${RARITY_COLORS[item.rarity] || "text-primary/30"} tracking-widest uppercase font-mono`}>
            {item.rarity !== "common" ? item.rarity : ""}
          </span>
          {item.slot && item.slot !== "none" && (
            <span className="text-primary/40 font-mono text-[8px]">({item.slot})</span>
          )}
        </div>

        {item.description && isExpanded && (
          <p className="text-[8px] font-mono text-current/60 leading-relaxed mb-2 line-clamp-3">
            {item.description}
          </p>
        )}

        {isExpanded && (
          <div className="flex gap-1.5 pt-2 border-t border-current/20">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEquipToggle(item.id, !item.equipped);
              }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 border border-current/30 hover:border-current/60 text-current/50 hover:text-current transition-all text-[8px] tracking-widest uppercase"
            >
              <Check className="w-2.5 h-2.5" />
              {item.equipped ? "Unequip" : "Equip"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
              className="px-2 py-1 border border-red-900/30 text-red-900/50 hover:text-red-400 hover:border-red-400/40 transition-all text-[8px] tracking-widest uppercase"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Equipped items */}
      {equippedItems.length > 0 && (
        <div>
          <h3 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase mb-3 pb-2 border-b border-primary/10">
            ⚡ Equipped ({equippedItems.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <AnimatePresence>
              {equippedItems.map(renderItemCard)}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Unequipped items */}
      {unequippedItems.length > 0 && (
        <div>
          <h3 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase mb-3 pb-2 border-b border-primary/10">
            📦 Inventory ({unequippedItems.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <AnimatePresence>
              {unequippedItems.map(renderItemCard)}
            </AnimatePresence>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="text-center py-12">
          <Package className="w-8 h-8 text-primary/10 mx-auto mb-3" />
          <p className="font-mono text-[10px] text-primary/20 tracking-widest uppercase">
            No items discovered yet
          </p>
        </div>
      )}
    </div>
  );
}