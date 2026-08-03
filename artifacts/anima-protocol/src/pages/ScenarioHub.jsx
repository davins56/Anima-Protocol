import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Search, Plus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import ScenarioCard from '@/components/scenarios/ScenarioCard';
import ScenarioRemixModal from '@/components/scenarios/ScenarioRemixModal';

export default function ScenarioHub() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('all');
  const [selectedScenario, setSelectedScenario] = useState(null);

  useEffect(() => {
    loadScenarios();
  }, []);

  const loadScenarios = async () => {
    try {
      const data = await base44.entities.SharedScenario.filter(
        { is_published: true },
        '-remix_count',
        100
      );
      setScenarios(data || []);
    } catch (err) {
      console.error('Error loading scenarios:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredScenarios = scenarios.filter(s => {
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = selectedTag === 'all' || s.tags?.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const allTags = [...new Set(scenarios.flatMap(s => s.tags || []))].sort();

  const handleRemix = (scenario) => {
    setSelectedScenario(scenario);
  };

  const handleRemixComplete = (newSession) => {
    setSelectedScenario(null);
    navigate(`/chat/${newSession.id}`);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-sacred text-3xl sm:text-4xl text-primary tracking-wider">Scenario Hub</h1>
              <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase mt-2">
                Community created scenarios, ready to remix
              </p>
            </div>
            <button
              onClick={() => navigate('/create-scenario')}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create</span>
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search scenarios..."
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedTag('all')}
              className={`px-3 py-1 text-[9px] font-mono tracking-widest uppercase border rounded transition-all ${
                selectedTag === 'all'
                  ? 'bg-primary/10 border-primary/50 text-primary'
                  : 'border-primary/15 text-primary/40 hover:text-primary/60'
              }`}
            >
              All
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-3 py-1 text-[9px] font-mono tracking-widest uppercase border rounded transition-all ${
                  selectedTag === tag
                    ? 'bg-primary/10 border-primary/50 text-primary'
                    : 'border-primary/15 text-primary/40 hover:text-primary/60'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="text-center py-12">
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase animate-pulse">
              Loading scenarios...
            </p>
          </div>
        ) : filteredScenarios.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">No scenarios found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredScenarios.map(scenario => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                onRemix={handleRemix}
              />
            ))}
          </div>
        )}
      </div>

      {/* Remix Modal */}
      <AnimatePresence>
        {selectedScenario && (
          <ScenarioRemixModal
            scenario={selectedScenario}
            onClose={() => setSelectedScenario(null)}
            onRemixComplete={handleRemixComplete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}