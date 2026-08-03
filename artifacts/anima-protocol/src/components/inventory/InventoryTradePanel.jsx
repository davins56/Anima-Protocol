import { useState, useEffect } from 'react';
import { Send, X, Check, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';

export default function InventoryTradePanel({ 
  sessionId, 
  characterId, 
  characters, 
  onTradeComplete 
}) {
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [availableItems, setAvailableItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadInventoryAndTrades();
  }, [characterId, sessionId]);

  const loadInventoryAndTrades = async () => {
    try {
      const [items, allTrades] = await Promise.all([
        base44.entities.Inventory.filter({ character_id: characterId, session_id: sessionId }),
        base44.entities.Trade.filter({ session_id: sessionId }),
      ]);
      setAvailableItems(items || []);
      setTrades(allTrades || []);
    } catch (err) {
      console.error('Error loading inventory:', err);
    }
  };

  const handleInitiateTrade = async () => {
    if (!selectedRecipient || selectedItems.length === 0) return;
    setLoading(true);

    try {
      await base44.functions.invoke('inventoryTrading', {
        action: 'initiate_trade',
        session_id: sessionId,
        initiator_id: characterId,
        recipient_id: selectedRecipient,
        initiator_items: selectedItems,
      });

      setSelectedItems([]);
      setSelectedRecipient(null);
      await loadInventoryAndTrades();
    } catch (err) {
      console.error('Trade initiation failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptTrade = async (tradeId) => {
    setLoading(true);
    try {
      await base44.functions.invoke('inventoryTrading', {
        action: 'accept_trade',
        trade_id: tradeId,
      });
      await loadInventoryAndTrades();
      onTradeComplete?.(tradeId);
    } catch (err) {
      console.error('Trade acceptance failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleItemSelection = (itemId) => {
    setSelectedItems(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  const pendingTrades = trades.filter(t => t.status === 'pending');
  const completedTrades = trades.filter(t => t.status === 'completed');

  return (
    <div className="space-y-4 p-3 border border-primary/20 bg-black/40 rounded">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary/60" />
        <h3 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">Inventory Trading</h3>
      </div>

      {/* Initiate Trade Section */}
      <div className="space-y-2 p-2 border border-primary/10 bg-black/30 rounded">
        <p className="text-[8px] font-mono text-primary/50 tracking-widest">Initiate Trade</p>

        {/* Recipient Selection */}
        <select
          value={selectedRecipient || ''}
          onChange={(e) => setSelectedRecipient(e.target.value || null)}
          className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-2.5 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
        >
          <option value="">Select recipient...</option>
          {characters?.filter(c => c.id !== characterId).map(char => (
            <option key={char.id} value={char.id}>{char.name}</option>
          ))}
        </select>

        {/* Available Items to Trade */}
        {selectedRecipient && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {availableItems.map(item => (
              <label key={item.id} className="flex items-center gap-2 p-1.5 border border-primary/15 bg-black/50 rounded hover:border-primary/30 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedItems.includes(item.id)}
                  onChange={() => toggleItemSelection(item.id)}
                  className="w-3 h-3 accent-primary"
                />
                <span className="text-[8px] font-mono text-primary/70">{item.name}</span>
                <span className="text-[7px] text-primary/40 ml-auto">x{item.quantity}</span>
              </label>
            ))}
          </div>
        )}

        <button
          onClick={handleInitiateTrade}
          disabled={!selectedRecipient || selectedItems.length === 0 || loading}
          className="w-full px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed font-mono text-[8px] tracking-widest uppercase transition-all rounded flex items-center justify-center gap-1.5"
        >
          <Send className="w-3 h-3" />
          Send Offer
        </button>
      </div>

      {/* Pending Trades Section */}
      {pendingTrades.length > 0 && (
        <div className="space-y-1.5 p-2 border border-yellow-400/20 bg-yellow-900/10 rounded">
          <p className="text-[8px] font-mono text-yellow-400/70 tracking-widest">Pending Offers ({pendingTrades.length})</p>
          {pendingTrades.map(trade => (
            <div key={trade.id} className="p-1.5 border border-yellow-400/20 bg-black/40 rounded space-y-1">
              <p className="text-[8px] font-mono text-primary/70">
                {trade.initiator_name} offers {trade.initiator_items?.length || 0} item(s)
              </p>
              {trade.recipient_id === characterId && (
                <button
                  onClick={() => handleAcceptTrade(trade.id)}
                  disabled={loading}
                  className="w-full px-2 py-1 bg-green-600/30 border border-green-400/40 text-green-400 hover:bg-green-600/50 disabled:opacity-30 font-mono text-[8px] tracking-widest uppercase transition-all rounded flex items-center justify-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  Accept
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Completed Trades Summary */}
      {completedTrades.length > 0 && (
        <div className="text-[8px] font-mono text-primary/40 p-1.5 border border-primary/10 rounded">
          {completedTrades.length} completed trade(s)
        </div>
      )}
    </div>
  );
}