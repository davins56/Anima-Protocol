import { useState, useEffect } from "react";
import ContextualInventorySuggestions from "../inventory/ContextualInventorySuggestions";
import { X, Package, Plus, Trash2, Shield, Sword, Zap, Star, Edit2, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";

const TYPE_ICONS = {
  gear: Shield,
  consumable: Zap,
  weapon: Sword,
  armor: Shield,
  artifact: Star,
  misc: Package,
};

const TYPE_COLORS = {
  gear: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",
  consumable: "text-green-400 border-green-400/30 bg-green-400/5",
  weapon: "text-red-400 border-red-400/30 bg-red-400/5",
  armor: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  artifact: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  misc: "text-primary/60 border-primary/20 bg-primary/5",
};

const RARITY_COLORS = {
  common: "text-primary/40",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  legendary: "text-yellow-400",
};

const ITEM_TYPES = ["gear", "consumable", "weapon", "armor", "artifact", "misc"];
const SLOTS = ["none", "head", "chest", "hands", "feet", "weapon", "offhand", "accessory"];

const defaultForm = { name: "", type: "misc", quantity: 1, description: "", rarity: "common", slot: "none", equipped: false };

export default function InventoryDrawer({ characterId, characterName, onClose, recentMessages }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (characterId) loadItems();
  }, [characterId]);

  const loadItems = async () => {
    setLoading(true);
    const data = await base44.entities.Inventory.filter({ character_id: characterId }, "-created_date", 100);
    setItems(data || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    await base44.entities.Inventory.create({ ...form, character_id: characterId });
    setForm(defaultForm);
    setShowAddForm(false);
    await loadItems();
  };

  const handleUpdate = async (id, patch) => {
    await base44.entities.Inventory.update(id, patch);
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  const handleDelete = async (id) => {
    await base44.entities.Inventory.delete(id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    await base44.entities.Inventory.update(editingId, form);
    setEditingId(null);
    await loadItems();
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setForm({ name: item.name, type: item.type, quantity: item.quantity, description: item.description || "", rarity: item.rarity || "common", slot: item.slot || "none", equipped: item.equipped || false });
  };

  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);
  const equipped = items.filter(i => i.equipped);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-sm h-full bg-background border-l border-primary/30 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20 bg-black/60">
          <div>
            <h2 className="font-mono text-xs text-primary tracking-[0.2em] uppercase">// Inventory</h2>
            <p className="text-[9px] font-mono text-primary/30 tracking-widest mt-0.5">{characterName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowAddForm(true); setEditingId(null); setForm(defaultForm); }}
              className="flex items-center gap-1 px-2.5 py-1 border border-primary/30 text-primary/60 hover:text-primary hover:border-primary/60 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
            <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Contextual Suggestions */}
        <div className="px-4 pt-4 pb-2">
          <ContextualInventorySuggestions
            items={items}
            recentMessages={recentMessages}
            onItemSuggested={(item) => {
              base44.functions.invoke("updateInventory", {
                character_id: characterId,
                session_id: null,
                user_message: `Using ${item.name}`,
                ai_response: `[INVENTORY: ${item.name} used in context]`,
                existing_items: items.map(i => ({ name: i.name, type: i.type, quantity: i.quantity, equipped: i.equipped })),
                message_index: 0,
              }).catch(() => {});
            }}
          />
        </div>

        {/* Equipped bar */}
        {equipped.length > 0 && (
          <div className="px-4 py-2 border-b border-primary/10 bg-primary/5">
            <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-1.5">Equipped</p>
            <div className="flex flex-wrap gap-1.5">
              {equipped.map(item => {
                const Icon = TYPE_ICONS[item.type] || Package;
                return (
                  <div key={item.id} className="flex items-center gap-1 px-2 py-0.5 border border-primary/30 bg-primary/10">
                    <Icon className="w-2.5 h-2.5 text-primary/60" />
                    <span className="font-mono text-[9px] text-primary/70 tracking-wider">{item.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Add / Edit Form */}
        {(showAddForm || editingId) && (
          <div className="px-4 py-3 border-b border-primary/20 bg-black/40 space-y-2">
            <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">{editingId ? "Edit Item" : "Add Item"}</p>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Item name..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description (optional)..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-xs px-3 py-1.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-[10px] px-2 py-1.5 focus:outline-none focus:border-primary/40"
              >
                {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={form.rarity}
                onChange={e => setForm(f => ({ ...f, rarity: e.target.value }))}
                className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-[10px] px-2 py-1.5 focus:outline-none focus:border-primary/40"
              >
                {["common","uncommon","rare","legendary"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select
                value={form.slot}
                onChange={e => setForm(f => ({ ...f, slot: e.target.value }))}
                className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-[10px] px-2 py-1.5 focus:outline-none focus:border-primary/40"
              >
                {SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input
                type="number" min="1"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                className="bg-black/60 border border-primary/20 text-primary/70 font-mono text-[10px] px-2 py-1.5 focus:outline-none focus:border-primary/40"
                placeholder="Qty"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddForm(false); setEditingId(null); }}
                className="flex-1 py-1.5 border border-primary/15 text-primary/30 hover:text-primary/60 font-mono text-[9px] tracking-widest uppercase transition-all"
              >Cancel</button>
              <button
                onClick={editingId ? handleEditSave : handleAdd}
                disabled={!form.name.trim()}
                className="flex-1 py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all"
              >
                {editingId ? "Save" : "Add"}
              </button>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-primary/10 overflow-x-auto flex-shrink-0">
          {["all", ...ITEM_TYPES].map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2.5 py-1 font-mono text-[9px] tracking-widest uppercase whitespace-nowrap transition-all border ${
                filter === t ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-primary/30 hover:text-primary/60"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Items list */}
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1.5">
          {loading ? (
            <p className="text-center font-mono text-[9px] text-primary/20 tracking-widest uppercase py-8 animate-pulse">Loading...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-8 h-8 text-primary/10 mx-auto mb-3" />
              <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase">
                {filter === "all" ? "No items in inventory" : `No ${filter} items`}
              </p>
            </div>
          ) : (
            filtered.map(item => {
              const Icon = TYPE_ICONS[item.type] || Package;
              const colorClass = TYPE_COLORS[item.type] || TYPE_COLORS.misc;
              return (
                <div
                  key={item.id}
                  className={`group flex items-start gap-3 p-3 border transition-all ${
                    item.equipped ? "border-primary/40 bg-primary/5" : "border-primary/10 bg-black/30 hover:border-primary/25"
                  }`}
                >
                  <div className={`w-7 h-7 border flex items-center justify-center flex-shrink-0 mt-0.5 ${colorClass}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-primary/80 tracking-wider truncate">{item.name}</span>
                      {item.quantity > 1 && (
                        <span className="font-mono text-[9px] text-primary/40 flex-shrink-0">×{item.quantity}</span>
                      )}
                      <span className={`font-mono text-[8px] tracking-widest uppercase flex-shrink-0 ${RARITY_COLORS[item.rarity] || "text-primary/30"}`}>
                        {item.rarity !== "common" ? item.rarity : ""}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-[9px] font-mono text-primary/30 mt-0.5 leading-relaxed line-clamp-2">{item.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[8px] font-mono text-primary/25 tracking-widest uppercase">{item.type}</span>
                      {item.slot && item.slot !== "none" && (
                        <span className="text-[8px] font-mono text-primary/20 tracking-widest">· {item.slot}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    {/* Equip toggle */}
                    <button
                      onClick={() => handleUpdate(item.id, { equipped: !item.equipped })}
                      title={item.equipped ? "Unequip" : "Equip"}
                      className={`w-5 h-5 border flex items-center justify-center transition-colors ${
                        item.equipped ? "border-primary/60 text-primary" : "border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40"
                      }`}
                    >
                      <Check className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={() => startEdit(item)}
                      className="w-5 h-5 border border-primary/15 text-primary/25 hover:text-primary/60 hover:border-primary/35 flex items-center justify-center transition-colors"
                    >
                      <Edit2 className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="w-5 h-5 border border-red-900/20 text-red-900/40 hover:text-red-400 hover:border-red-400/40 flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Stats footer */}
        <div className="px-4 py-2 border-t border-primary/10 bg-black/40 flex items-center justify-between">
          <span className="font-mono text-[9px] text-primary/25 tracking-widest uppercase">{items.length} items total</span>
          <span className="font-mono text-[9px] text-primary/25 tracking-widest uppercase">{equipped.length} equipped</span>
        </div>
      </div>
    </div>
  );
}