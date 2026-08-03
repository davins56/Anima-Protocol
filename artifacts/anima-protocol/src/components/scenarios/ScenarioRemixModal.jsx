import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Loader } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function ScenarioRemixModal({ scenario, onClose, onRemixComplete }) {
  const [name, setName] = useState(`${scenario.title} - Remix`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRemix = async () => {
    if (!name.trim()) {
      setError('Please name your remix');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Create new ChatSession from scenario
      const newSession = await base44.entities.ChatSession.create({
        title: name.trim(),
        mode: 'solo',
        character_id: scenario.character_bases?.[0]?.id,
        opening_scene: scenario.prompt,
        world_settings: scenario.world_settings || {},
        scenario_source_id: scenario.id,
        is_remix: true,
        messages: [
          {
            role: 'system',
            character_name: 'Narrator',
            content: scenario.prompt,
            timestamp: new Date().toISOString(),
          },
        ],
      });

      // Increment remix count
      await base44.entities.SharedScenario.update(scenario.id, {
        remix_count: (scenario.remix_count || 0) + 1,
      });

      onRemixComplete(newSession);
    } catch (err) {
      setError(err.message || 'Failed to create remix');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md border border-primary/30 bg-black/95 rounded-lg p-6 space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-lg text-primary tracking-wide">Remix Scenario</h2>
          <button onClick={onClose} className="text-primary/40 hover:text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info */}
        <div className="space-y-2 p-3 bg-primary/5 border border-primary/10 rounded">
          <p className="text-[9px] font-mono text-primary/60 tracking-widest uppercase">Source</p>
          <p className="text-sm font-mono text-primary">{scenario.title}</p>
          {scenario.description && (
            <p className="text-[10px] text-primary/70 mt-2">{scenario.description}</p>
          )}
        </div>

        {/* Input */}
        <div className="space-y-2">
          <label className="text-[9px] font-mono text-primary/50 tracking-widest uppercase block">
            Your Remix Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
            placeholder="Name your remix..."
          />
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-900/20 border border-red-400/30 rounded">
            <p className="text-[9px] font-mono text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-primary/20 text-primary/50 hover:text-primary font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleRemix}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-cyan-600/30 border border-cyan-400/60 text-cyan-400 hover:bg-cyan-600/50 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2"
          >
            {loading && <Loader className="w-3 h-3 animate-spin" />}
            {loading ? 'Creating...' : 'Remix'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}