import { useState, useEffect } from "react";
import { X, Loader } from "lucide-react";
import { motion } from "framer-motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ITEM_TYPES = ["gear", "consumable", "weapon", "armor", "artifact", "misc"];
const SLOTS = ["none", "head", "chest", "hands", "feet", "weapon", "offhand", "accessory"];
const RARITIES = ["common", "uncommon", "rare", "legendary"];

export default function InventoryItemForm({ item, characterId, onSave, onCancel, loading }) {
  const [form, setForm] = useState({
    name: "",
    type: "misc",
    slot: "none",
    rarity: "common",
    quantity: 1,
    description: "",
    equipped: false,
  });

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name || "",
        type: item.type || "misc",
        slot: item.slot || "none",
        rarity: item.rarity || "common",
        quantity: item.quantity || 1,
        description: item.description || "",
        equipped: item.equipped || false,
      });
    }
  }, [item]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md bg-background border border-primary/30 rounded hud-corner glow-border max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60 sticky top-0 z-10">
          <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
            {item ? "// Edit Item" : "// New Item"}
          </h2>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-primary/30 hover:text-primary transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Item Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g., Iron Sword"
              disabled={loading}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Item details..."
              disabled={loading}
              rows={3}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors resize-none disabled:opacity-50"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Type
            </label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))} disabled={loading}>
              <SelectTrigger className="w-full bg-black/60 border-primary/20 text-primary/70 font-mono text-sm min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-primary/30">
                {ITEM_TYPES.map(t => (
                  <SelectItem key={t} value={t} className="font-mono text-primary/80">
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Rarity */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Rarity
            </label>
            <Select value={form.rarity} onValueChange={v => setForm(f => ({ ...f, rarity: v }))} disabled={loading}>
              <SelectTrigger className="w-full bg-black/60 border-primary/20 text-primary/70 font-mono text-sm min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-primary/30">
                {RARITIES.map(r => (
                  <SelectItem key={r} value={r} className="font-mono text-primary/80">
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Slot */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Equipment Slot
            </label>
            <Select value={form.slot} onValueChange={v => setForm(f => ({ ...f, slot: v }))} disabled={loading}>
              <SelectTrigger className="w-full bg-black/60 border-primary/20 text-primary/70 font-mono text-sm min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-primary/30">
                {SLOTS.map(s => (
                  <SelectItem key={s} value={s} className="font-mono text-primary/80">
                    {s === "none" ? "Not equippable" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-[9px] font-mono text-primary/40 tracking-[0.25em] uppercase mb-2">
              Quantity
            </label>
            <input
              type="number"
              min="1"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
              disabled={loading}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
            />
          </div>

          {/* Equipped toggle */}
          {form.slot !== "none" && (
            <label className="flex items-center gap-3 cursor-pointer p-2 border border-primary/15 hover:border-primary/30 hover:bg-primary/5 transition-all rounded">
              <input
                type="checkbox"
                checked={form.equipped}
                onChange={e => setForm(f => ({ ...f, equipped: e.target.checked }))}
                disabled={loading}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-[9px] font-mono text-primary/60 tracking-widest uppercase">
                Currently Equipped
              </span>
            </label>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-primary/10">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
            >
              {loading ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Saving
                </>
              ) : (
                item ? "Update" : "Add Item"
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}