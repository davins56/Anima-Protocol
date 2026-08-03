import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// Dynamically import cytoscape to avoid SSR issues
let cytoscape;
if (typeof window !== 'undefined') {
  import('cytoscape').then(mod => { cytoscape = mod.default; });
}

export default function CytoscapeForceGraph({ sessionId }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [conflictData, setConflictData] = useState({});

  useEffect(() => {
    loadGraphData();
  }, [sessionId]);

  const loadGraphData = async () => {
    setLoading(true);
    try {
      // Get influence scores
      const influenceRes = await base44.functions.invoke('calculateInfluenceScores', { session_id: sessionId });
      setGraphData(influenceRes?.data);

      // Get conflict intensity for edges
      const conflictRes = await base44.functions.invoke('analyzeConflictIntensity', { session_id: sessionId });
      setConflictData(conflictRes?.data || {});
    } catch (err) {
      console.error('Error loading graph data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!graphData || !cytoscape || !containerRef.current) return;

    // Prepare cytoscape elements
    const elements = [
      ...graphData.nodes.map(node => ({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          influenceScore: node.influenceScore,
        },
        classes: `${node.type} influence-${Math.ceil(node.influenceScore / 20)}`,
      })),
      ...graphData.edges.map(edge => ({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          weight: edge.weight,
          tier: edge.tier,
        },
        classes: edge.type || 'relationship',
      })),
    ];

    // Initialize Cytoscape
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'content': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': 11,
            'font-family': 'monospace',
            'color': 'hsl(185 100% 80%)',
            'text-opacity': 0.9,
            'background-opacity': 0.8,
            'border-width': 2,
            'border-color': 'hsl(185 100% 50%)',
          },
        },
        {
          selector: 'node.character',
          style: {
            'width': 'mapData(influenceScore, 0, 100, 30, 120)',
            'height': 'mapData(influenceScore, 0, 100, 30, 120)',
            'background-color': 'hsl(185 100% 35%)',
          },
        },
        {
          selector: 'node.location',
          style: {
            'width': 'mapData(influenceScore, 0, 100, 25, 100)',
            'height': 'mapData(influenceScore, 0, 100, 25, 100)',
            'background-color': 'hsl(60 70% 50%)',
            'shape': 'square',
          },
        },
        {
          selector: 'node:hover',
          style: {
            'background-color': 'hsl(185 100% 50%)',
            'box-shadow': '0 0 20px hsl(185 100% 50%)',
          },
        },
        {
          selector: 'edge.relationship',
          style: {
            'line-color': 'hsl(185 50% 30%)',
            'target-arrow-color': 'hsl(185 50% 30%)',
            'target-arrow-shape': 'triangle',
            'width': 2,
            'curve-style': 'bezier',
            'opacity': 0.6,
          },
        },
        {
          selector: 'edge.memory',
          style: {
            'line-color': 'hsl(280 60% 50%)',
            'line-style': 'dashed',
            'width': 1.5,
            'opacity': 0.4,
          },
        },
        {
          selector: 'node.selected',
          style: {
            'background-color': 'hsl(185 100% 60%)',
            'box-shadow': '0 0 30px hsl(185 100% 60%)',
            'border-width': 3,
          },
        },
      ],
      layout: {
        name: 'cose',
        directed: false,
        roots: '#root',
        padding: 30,
        componentSpacing: 100,
        nodeSpacing: 50,
        refresh: 20,
        maxIterations: 1000,
        fit: true,
        randomize: false,
        gravity: 1,
        friction: 0.6,
        damping: 0.4,
      },
    });

    // Apply force-directed layout with physics
    const layout = cy.layout({ name: 'cose' });
    layout.run();

    // Click event for node selection
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      cy.elements().removeClass('selected');
      node.addClass('selected');
      setSelectedNode(node.data());
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass('selected');
        setSelectedNode(null);
      }
    });

    cyRef.current = cy;

    return () => {
      if (cyRef.current) cyRef.current.destroy();
    };
  }, [graphData]);

  const handleZoom = (direction) => {
    if (!cyRef.current) return;
    const zoom = cyRef.current.zoom();
    cyRef.current.zoom(direction === 'in' ? zoom * 1.2 : zoom / 1.2);
  };

  const handleFit = () => {
    if (!cyRef.current) cyRef.current.fit();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-2" />
          <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">Building force graph...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border border-primary/20 bg-black/40 rounded overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-primary/10 bg-primary/5">
          <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
            ⚛️ Force-Directed Network ({graphData?.nodes?.length} entities)
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => handleZoom('in')}
              className="p-1.5 text-primary/40 hover:text-primary hover:bg-primary/10 transition-all"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleZoom('out')}
              className="p-1.5 text-primary/40 hover:text-primary hover:bg-primary/10 transition-all"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleFit}
              className="p-1.5 text-primary/40 hover:text-primary hover:bg-primary/10 transition-all"
              title="Fit to view"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div ref={containerRef} style={{ width: '100%', height: '600px', background: 'hsl(220 20% 4%)' }} />
      </div>

      {/* Legend */}
      <div className="p-3 border border-primary/15 bg-black/30 rounded text-[8px] font-mono space-y-2">
        <p className="text-primary/40 tracking-widest uppercase font-semibold">Legend</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cyan-400" />
            <span className="text-primary/60">Character (size = influence)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-yellow-400" />
            <span className="text-primary/60">Location (size = events)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-px bg-cyan-600" />
            <span className="text-primary/60">Relationship</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-px bg-purple-500" style={{ borderTop: '1px dashed' }} />
            <span className="text-primary/60">Memory Link</span>
          </div>
        </div>
      </div>

      {/* Node Details */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 border border-primary/20 bg-black/40 rounded space-y-2"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-sm text-primary tracking-wider uppercase">{selectedNode.label}</p>
                <p className="text-[9px] text-primary/50 mt-0.5 capitalize">{selectedNode.type}</p>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-primary/10">
              <div className="flex-1 h-2 bg-black/60 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${selectedNode.influenceScore}%` }}
                  className="h-full bg-gradient-to-r from-cyan-400 to-primary"
                />
              </div>
              <span className="text-[9px] font-mono text-primary/60 flex-shrink-0">
                {Math.round(selectedNode.influenceScore)}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}