import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, X, Loader, Filter, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import InventoryItemCard from "./InventoryItemCard";
import InventoryItemForm from "./InventoryItemForm";

const ITEM_TYPES = ["all", "gear", "consumable", "weapon", "armor", "artifact", "misc"];
const SLOTS = ["none", "head", "chest", "hands", "feet", "weapon", "offhand", "accessory"];

export default function InventoryManager({ characterId, sessionId, onItemsChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    if (characterId) {
      loadItems();
    }
  }, [characterId]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Inventory.filter(
        { character_id: characterId },
        "-created_date",
        100
      );
      setItems(data || []);
      onItemsChange?.(data || []);
    } catch (err) {
      console.error("Error loading inventory:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (formData) => {
    setFormLoading(true);
    try {
      if (editingItem) {
        await base44.entities.Inventory.update(editingItem.id, formData);
        setItems(prev => prev.map(i => i.id === editingItem.id ? { ...i, ...formData } : i));
      } else {
        const newItem = await base44.entities.Inventory.create({
          ...formData,
          character_id: characterId,
          session_id: sessionId || null,
        });
        setItems(prev => [newItem, ...prev]);
      }
      setShowForm(false);
      setEditingItem(null);
      onItemsChange?.([...items]);
    } catch (err) {
      console.error("Error saving item:", err);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!confirm("Delete this item?")) return;
    try {
      await base44.entities.Inventory.delete(itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
      onItemsChange?.([...items].filter(i => i.id !== itemId));
    } catch (err) {
      console.error("Error deleting item:", err);
    }
  };

  const handleEquipItem = async (itemId) => {
    try {
      const item = items.find(i => i.id === itemId);
      if (!item) return;
      
      // If equipping, unequip items in the same slot
      if (!item.equipped && item.slot && item.slot !== "none") {
        const sameSloItems = items.filter(i => i.slot === item.slot && i.equipped);
        await Promise.all(
          sameSloItems.map(i => base44.entities.Inventory.update(i.id, { equipped: false }))
        );
      }

      await base44.entities.Inventory.update(itemId, { equipped: !item.equipped });
      
      setItems(prev => prev.map(i => {
        if (i.id === itemId) return { ...i, equipped: !i.equipped };
        if (!item.equipped && item.slot && item.slot !== "none" && i.slot === item.slot) {
          return { ...i, equipped: false };
        }
        return i;
      }));
      
      onItemsChange?.([...items]);
    } catch (err) {
      console.error("Error equipping item:", err);
    }
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  // Filter and sort items
  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "type") return a.type.localeCompare(b.type);
    if (sortBy === "rarity") {
      const rarityOrder = { legendary: 0, rare: 1, uncommon: 2, common: 3 };
      return (rarityOrder[a.rarity] || 999) - (rarityOrder[b.rarity] || 999);
    }
    return 0;
  });

  const equipped = items.filter(i => i.equipped);
  const stats = {
    total: items.length,
    equipped: equipped.length,
    byType: ITEM_TYPES.slice(1).reduce((acc, type) => {
      acc[type] = items.filter(i => i.type === type).length;
      return acc;
    }, {}),
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-lg tracking-[0.2em] uppercase text-primary glow-text">
            // Inventory
          </h2>
          <p className="text-[9px] font-mono text-primary/40 tracking-widest mt-1">
            {stats.total} items · {stats.equipped} equipped
          </p>
        </div>
        <button
          onClick={() => {
            setEditingItem(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
        >
          <Plus className="w-4 h-4" />
          Add Item
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[9px] font-mono">
        {[
          { label: "Total", value: stats.total, color: "primary" },
          { label: "Equipped", value: stats.equipped, color: "green" },
          { label: "Weapons", value: stats.byType.weapon, color: "red" },
          { label: "Armor", value: stats.byType.armor, color: "blue" },
          { label: "Artifacts", value: stats.byType.artifact, color: "yellow" },
        ].map((stat, idx) => (
          <div
            key={idx}
            className={`p-2 border border-${stat.color}-400/20 bg-${stat.color}-400/5 rounded`}
          >
            <p className={`text-${stat.color}-400/60 tracking-widest uppercase`}>{stat.label}</p>
            <p className={`text-lg font-bold text-${stat.color}-400 mt-1`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        {/* Filter */}
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
        >
          {ITEM_TYPES.map(t => (
            <option key={t} value={t}>
              {t === "all" ? "All Types" : t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors"
        >
          <option value="name">Sort: Name</option>
          <option value="type">Sort: Type</option>
          <option value="rarity">Sort: Rarity</option>
        </select>
      </div>

      {/* Equipped items */}
      {equipped.length > 0 && (
        <div className="p-3 border border-primary/20 bg-primary/5 rounded space-y-2">
          <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase flex items-center gap-2">
            <TrendingUp className="w-3 h-3" /> Currently Equipped
          </p>
          <div className="flex flex-wrap gap-2">
            {equipped.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-1.5 px-2 py-1 border border-primary/40 bg-primary/10 rounded"
              >
                <span className="text-[9px] font-mono">{item.name}</span>
                {item.slot && item.slot !== "none" && (
                  <span className="text-[8px] text-primary/40">
                    [{item.slot.split("_").map(w => w[0]).join("")}]
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Items grid */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-6 h-6 text-primary/50 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase">
              {filter === "all" ? "No items yet" : `No ${filter} items`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence>
              {sorted.map(item => (
                <InventoryItemCard
                  key={item.id}
                  item={item}
                  onEquip={handleEquipItem}
                  onUnequip={handleEquipItem}
                  onDelete={handleDeleteItem}
                  onEdit={handleEditItem}
                  isLoading={formLoading}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Item form modal */}
      <AnimatePresence>
        {showForm && (
          <InventoryItemForm
            item={editingItem}
            characterId={characterId}
            onSave={handleAddItem}
            onCancel={() => {
              setShowForm(false);
              setEditingItem(null);
            }}
            loading={formLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}