import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, Filter, Loader, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import InventoryGrid from "@/components/inventory/InventoryGrid";
import { motion } from "framer-motion";

const ITEM_TYPES = ["all", "gear", "weapon", "armor", "consumable", "artifact", "misc"];
const RARITIES = ["all", "common", "uncommon", "rare", "legendary"];

export default function InventoryPanel() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const characterId = searchParams.get("character");

  const [characters, setCharacters] = useState([]);
  const [selectedChar, setSelectedChar] = useState(characterId || "");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState(null);
  const [stats, setStats] = useState({ total: 0, equipped: 0, byRarity: {} });

  useEffect(() => {
    loadCharacters();
  }, []);

  useEffect(() => {
    if (selectedChar) {
      loadInventory();
    }
  }, [selectedChar]);

  const loadCharacters = async () => {
    try {
      const chars = await base44.entities.Character.list("-created_date", 100);
      setCharacters(chars || []);
      if (!selectedChar && chars?.length > 0) {
        setSelectedChar(chars[0].id);
      }
    } catch (err) {
      console.error("Error loading characters:", err);
    }
  };

  const loadInventory = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Inventory.filter(
        { character_id: selectedChar },
        "-created_date",
        200
      );
      setItems(data || []);
      calculateStats(data || []);
    } catch (err) {
      console.error("Error loading inventory:", err);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (itemList) => {
    const byRarity = {
      common: 0,
      uncommon: 0,
      rare: 0,
      legendary: 0,
    };

    itemList.forEach(item => {
      byRarity[item.rarity || "common"]++;
    });

    setStats({
      total: itemList.length,
      equipped: itemList.filter(i => i.equipped).length,
      byRarity,
    });
  };

  const handleEquipToggle = async (itemId, equipped) => {
    await base44.entities.Inventory.update(itemId, { equipped });
    setItems(prev =>
      prev.map(i => (i.id === itemId ? { ...i, equipped } : i))
    );
    calculateStats(items.map(i => (i.id === itemId ? { ...i, equipped } : i)));
  };

  const handleDelete = async (itemId) => {
    await base44.entities.Inventory.delete(itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
    calculateStats(items.filter(i => i.id !== itemId));
    setSelectedItem(null);
  };

  const filteredItems = items.filter(item => {
    const typeMatch = filter === "all" || item.type === filter;
    const rarityMatch = rarityFilter === "all" || item.rarity === rarityFilter;
    return typeMatch && rarityMatch;
  });

  const currentChar = characters.find(c => c.id === selectedChar);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </Link>
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg sm:text-2xl">
              // Inventory Panel
            </h1>
            <p className="text-[9px] sm:text-[10px] font-mono text-primary/40 tracking-widest">
              Items & Artifacts Discovered
            </p>
          </div>
        </div>
      </div>

      {/* Character Selector & Stats */}
      <div className="px-4 sm:px-6 py-4 border-b border-primary/10 bg-black/40 space-y-4">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-[9px] font-mono text-primary/40 tracking-widest uppercase mb-2">
              Character
            </label>
            <select
              value={selectedChar}
              onChange={(e) => setSelectedChar(e.target.value)}
              className="w-full bg-black/60 border border-primary/20 text-primary/70 font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            >
              {characters.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 border border-primary/20 bg-primary/5">
            <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
              Total Items
            </p>
            <p className="text-xl font-mono text-primary">{stats.total}</p>
          </div>
          <div className="p-3 border border-primary/20 bg-primary/5">
            <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase mb-1">
              Equipped
            </p>
            <p className="text-xl font-mono text-primary">{stats.equipped}</p>
          </div>
          <div className="p-3 border border-yellow-400/20 bg-yellow-400/5">
            <p className="text-[8px] font-mono text-yellow-400/60 tracking-widest uppercase mb-1">
              Legendary
            </p>
            <p className="text-xl font-mono text-yellow-400">{stats.byRarity.legendary}</p>
          </div>
          <div className="p-3 border border-blue-400/20 bg-blue-400/5">
            <p className="text-[8px] font-mono text-blue-400/60 tracking-widest uppercase mb-1">
              Rare
            </p>
            <p className="text-xl font-mono text-blue-400">{stats.byRarity.rare}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 sm:px-6 py-3 border-b border-primary/10 bg-black/40 flex flex-col sm:flex-row gap-4 items-start sm:items-center overflow-x-auto">
        <div className="flex items-center gap-2 text-primary/60">
          <Filter className="w-4 h-4" />
          <span className="font-mono text-[9px] tracking-widest uppercase whitespace-nowrap">Filter:</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {ITEM_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-2.5 py-1 font-mono text-[8px] tracking-widest uppercase transition-all border ${
                filter === type
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-primary/15 text-primary/40 hover:text-primary/70"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {RARITIES.map(rarity => (
            <button
              key={rarity}
              onClick={() => setRarityFilter(rarity)}
              className={`px-2.5 py-1 font-mono text-[8px] tracking-widest uppercase transition-all border ${
                rarityFilter === rarity
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-primary/15 text-primary/40 hover:text-primary/70"
              }`}
            >
              {rarity}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-6 h-6 text-primary/60 animate-spin mx-auto mb-3" />
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                Loading inventory...
              </p>
            </div>
          </div>
        ) : (
          <InventoryGrid
            items={filteredItems}
            onEquipToggle={handleEquipToggle}
            onDelete={handleDelete}
            onSelect={setSelectedItem}
            selectedId={selectedItem?.id}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 sm:px-6 py-3 border-t border-primary/10 bg-black/60 flex items-center justify-between text-[9px] font-mono text-primary/25 tracking-widest uppercase">
        <span>{filteredItems.length} items shown</span>
        <span className="text-[8px]">v1.0</span>
      </div>
    </div>
  );
}