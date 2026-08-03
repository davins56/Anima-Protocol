import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Loader, Save } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import MemoryGraphVisualizer from '@/components/memory/MemoryGraphVisualizer';
import MemoryNodeEditor from '@/components/memory/MemoryNodeEditor';
import TraitEditor from '@/components/memory/TraitEditor';
import MilestonePanel from '@/components/memory/MilestonePanel';

export default function MemoryGraphDashboard() {
  const { characterId } = useParams();
  const [graph, setGraph] = useState(null);
  const [character, setCharacter] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [characterId]);

  const loadData = async () => {
    try {
      const [char, graphs] = await Promise.all([
        base44.entities.Character.list().then(chars => chars.find(c => c.id === characterId)),
        base44.entities.MemoryGraph.filter({ character_id: characterId }),
      ]);

      setCharacter(char);
      setGraph(graphs?.[0] || {
        character_id: characterId,
        nodes: [],
        edges: [],
        traits: [],
        milestones: [],
      });
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNodeClick = (node) => {
    setSelectedNode(node);
  };

  const handleNodeSave = async (updatedNode) => {
    const updatedNodes = graph.nodes.map(n => n.id === updatedNode.id ? updatedNode : n);
    const newGraph = { ...graph, nodes: updatedNodes, last_updated: new Date().toISOString() };
    setGraph(newGraph);
    setSelectedNode(null);
    await saveGraph(newGraph);
  };

  const handleNodeDelete = async () => {
    const newGraph = {
      ...graph,
      nodes: graph.nodes.filter(n => n.id !== selectedNode.id),
      edges: graph.edges.filter(e => e.from !== selectedNode.id && e.to !== selectedNode.id),
      last_updated: new Date().toISOString(),
    };
    setGraph(newGraph);
    setSelectedNode(null);
    await saveGraph(newGraph);
  };

  const handleAddTrait = (trait) => {
    const newGraph = {
      ...graph,
      traits: [...(graph.traits || []), { id: `trait-${Date.now()}`, ...trait }],
      last_updated: new Date().toISOString(),
    };
    setGraph(newGraph);
    saveGraph(newGraph);
  };

  const handleDeleteTrait = (traitId) => {
    const newGraph = {
      ...graph,
      traits: graph.traits.filter(t => t.id !== traitId),
      last_updated: new Date().toISOString(),
    };
    setGraph(newGraph);
    saveGraph(newGraph);
  };

  const handleAddMilestone = (milestone) => {
    const newGraph = {
      ...graph,
      milestones: [...(graph.milestones || []), { id: `milestone-${Date.now()}`, ...milestone }],
      last_updated: new Date().toISOString(),
    };
    setGraph(newGraph);
    saveGraph(newGraph);
  };

  const handleDeleteMilestone = (milestoneId) => {
    const newGraph = {
      ...graph,
      milestones: graph.milestones.filter(m => m.id !== milestoneId),
      last_updated: new Date().toISOString(),
    };
    setGraph(newGraph);
    saveGraph(newGraph);
  };

  const saveGraph = async (updatedGraph) => {
    setSaving(true);
    try {
      if (graph.id) {
        await base44.entities.MemoryGraph.update(graph.id, updatedGraph);
      } else {
        const created = await base44.entities.MemoryGraph.create(updatedGraph);
        updatedGraph.id = created.id;
      }
    } catch (err) {
      console.error('Error saving graph:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-sacred text-3xl sm:text-4xl text-primary tracking-wider">Memory Graph</h1>
            <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase mt-2">
              {character?.name || 'Character'} • Manage memories & continuity
            </p>
          </div>
          <button
            onClick={() => saveGraph(graph)}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Graph Visualizer */}
          <div className="lg:col-span-2 h-[500px] rounded-lg overflow-hidden">
            <MemoryGraphVisualizer
              graph={graph}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNode?.id}
            />
          </div>

          {/* Side Panel */}
          <div className="space-y-4">
            <AnimatePresence>
              {selectedNode && (
                <MemoryNodeEditor
                  node={selectedNode}
                  onSave={handleNodeSave}
                  onDelete={handleNodeDelete}
                  onClose={() => setSelectedNode(null)}
                />
              )}
            </AnimatePresence>

            {!selectedNode && (
              <div className="text-center p-4 border border-primary/15 bg-black/30 rounded text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                Click a node to edit
              </div>
            )}
          </div>
        </div>

        {/* Traits & Milestones */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TraitEditor
            traits={graph.traits || []}
            onAdd={handleAddTrait}
            onDelete={handleDeleteTrait}
          />
          <MilestonePanel
            milestones={graph.milestones || []}
            onAdd={handleAddMilestone}
            onDelete={handleDeleteMilestone}
          />
        </div>
      </div>
    </div>
  );
}