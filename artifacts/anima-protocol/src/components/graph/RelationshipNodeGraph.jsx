import { useEffect, useRef, useState } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import { motion } from 'framer-motion';
import { ZoomIn, ZoomOut, RotateCcw, Info } from 'lucide-react';

export default function RelationshipNodeGraph({
  characters = [],
  relationships = {},
  onNodeSelect,
  selectedCharacterId = null,
}) {
  const cyRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(selectedCharacterId);
  const [layout, setLayout] = useState('cose');

  // Build graph elements
  const elements = [];

  // Add character nodes
  characters.forEach((char) => {
    elements.push({
      data: {
        id: char.id,
        label: char.name,
        avatar: char.avatar_url,
        category: char.category || 'character',
      },
      classes: selectedNode === char.id ? 'selected' : '',
    });
  });

  // Add relationship edges
  const addedRelations = new Set();
  Object.entries(relationships).forEach(([charId, rel]) => {
    const edgeKey = [charId, rel.character_id].sort().join('-');
    if (!addedRelations.has(edgeKey)) {
      const score = rel.score || 0;
      const isSentimentPositive = score > 0;
      
      elements.push({
        data: {
          id: edgeKey,
          source: charId,
          target: rel.character_id,
          weight: Math.abs(score),
          score: score,
          sentiment: isSentimentPositive ? 'positive' : 'negative',
          tier: rel.tier || 'neutral',
        },
        classes: isSentimentPositive ? 'positive-edge' : 'negative-edge',
      });
      
      addedRelations.add(edgeKey);
    }
  });

  const styles = [
    {
      selector: 'node',
      style: {
        'background-color': '#0a0f1e',
        'border-color': 'hsl(185 100% 50%)',
        'border-width': 2,
        'width': 50,
        'height': 50,
        'label': 'data(label)',
        'font-size': 10,
        'color': 'hsl(185 100% 80%)',
        'font-family': '"Share Tech Mono", monospace',
        'text-valign': 'center',
        'text-halign': 'center',
        'overlay-padding': 5,
        'z-index': 10,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': 'hsl(185 100% 80%)',
        'box-shadow': '0 0 10px hsl(185 100% 50%)',
        'width': 65,
        'height': 65,
        'z-index': 20,
      },
    },
    {
      selector: 'node:hover',
      style: {
        'border-width': 3,
        'background-color': 'hsl(185 100% 15%)',
      },
    },
    {
      selector: 'edge',
      style: {
        'target-arrow-shape': 'none',
        'line-color': '#888',
        'width': 'mapData(weight, 0, 100, 1, 6)',
        'opacity': 0.6,
        'curve-style': 'bezier',
        'arrow-scale': 1.5,
      },
    },
    {
      selector: 'edge.positive-edge',
      style: {
        'line-color': '#51cf66',
        'target-arrow-color': '#51cf66',
      },
    },
    {
      selector: 'edge.negative-edge',
      style: {
        'line-color': '#ff6b6b',
        'target-arrow-color': '#ff6b6b',
      },
    },
    {
      selector: 'edge:hover',
      style: {
        'opacity': 1,
      },
    },
  ];

  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;
      
      // Layout
      const layoutOptions = {
        name: layout,
        directed: false,
        nodeDimensionsIncludeLabels: true,
        animate: true,
        animationDuration: 500,
        // Cose-specific
        ...(layout === 'cose' && {
          nodeSpacing: 20,
          componentSpacing: 40,
          nodeRepulsion: 400000,
          edgeElasticity: 100,
          nestingFactor: 1.2,
          gravity: 250,
          numIter: 2500,
          initialTemp: 200,
          coolingFactor: 0.95,
          minTemp: 1.0,
        }),
      };

      const layoutInstance = cy.layout(layoutOptions);
      layoutInstance.run();

      // Handle node selection
      cy.on('tap', 'node', (evt) => {
        const node = evt.target;
        setSelectedNode(node.id());
        onNodeSelect?.(node.data());
      });

      // Deselect on background tap
      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          setSelectedNode(null);
        }
      });
    }
  }, [layout, onNodeSelect]);

  const handleZoomIn = () => {
    if (cyRef.current) {
      cyRef.current.zoom(cyRef.current.zoom() * 1.2);
    }
  };

  const handleZoomOut = () => {
    if (cyRef.current) {
      cyRef.current.zoom(cyRef.current.zoom() / 1.2);
    }
  };

  const handleFit = () => {
    if (cyRef.current) {
      cyRef.current.fit(cyRef.current.elements(), 50);
    }
  };

  const handleLayoutChange = (newLayout) => {
    setLayout(newLayout);
  };

  return (
    <div className="space-y-3 h-full flex flex-col">
      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 p-3 border border-primary/20 bg-black/40 rounded-lg flex-wrap"
      >
        <div className="flex gap-1">
          <button
            onClick={handleZoomIn}
            className="p-2 border border-primary/20 text-primary/40 hover:text-primary/70 transition-colors rounded"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 border border-primary/20 text-primary/40 hover:text-primary/70 transition-colors rounded"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleFit}
            className="p-2 border border-primary/20 text-primary/40 hover:text-primary/70 transition-colors rounded"
            title="Fit to view"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="border-l border-primary/10 h-5" />

        <div className="flex gap-1">
          {['cose', 'grid', 'circle'].map((layoutName) => (
            <button
              key={layoutName}
              onClick={() => handleLayoutChange(layoutName)}
              className={`px-2 py-1 font-mono text-[8px] tracking-widest uppercase rounded transition-all ${
                layout === layoutName
                  ? 'bg-primary/20 border border-primary/50 text-primary'
                  : 'border border-primary/20 text-primary/40 hover:text-primary/70'
              }`}
            >
              {layoutName}
            </button>
          ))}
        </div>

        <div className="border-l border-primary/10 h-5 ml-auto" />

        {/* Legend */}
        <div className="flex gap-2 text-[8px]">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-0.5 bg-green-400" />
            <span className="text-primary/50">Positive</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-0.5 bg-red-400" />
            <span className="text-primary/50">Negative</span>
          </div>
        </div>
      </motion.div>

      {/* Graph */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 border border-primary/20 bg-black/40 rounded-lg overflow-hidden"
      >
        <CytoscapeComponent
          elements={elements}
          style={{ width: '100%', height: '100%' }}
          cy={cyRef}
          stylesheet={styles}
          layout={{
            name: layout,
            directed: false,
            nodeDimensionsIncludeLabels: true,
            animate: true,
          }}
        />
      </motion.div>

      {/* Info Panel */}
      {selectedNode && relationships[selectedNode] && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 border border-cyan-400/20 bg-cyan-900/10 rounded-lg"
        >
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <p className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">
              {characters.find(c => c.id === selectedNode)?.name || 'Selected'}
            </p>
          </div>

          {Object.entries(relationships)
            .filter(([id]) => id === selectedNode)
            .map(([_, rel]) => (
              <div key={rel.character_id} className="text-[8px] text-cyan-400/70 space-y-1">
                <p>
                  <span className="text-cyan-400/50">Relationship Tier:</span>{' '}
                  <span className="font-semibold uppercase">{rel.tier}</span>
                </p>
                <p>
                  <span className="text-cyan-400/50">Affinity Score:</span>{' '}
                  <span className="font-semibold">{rel.score || 0}/100</span>
                </p>
                {rel.last_interaction && (
                  <p className="text-[7px] text-cyan-400/50">
                    Last: {new Date(rel.last_interaction).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
        </motion.div>
      )}
    </div>
  );
}