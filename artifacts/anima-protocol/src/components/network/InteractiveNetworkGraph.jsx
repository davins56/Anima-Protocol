import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, Loader, Plus, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function InteractiveNetworkGraph({
  nodes,
  edges,
  selectedCharId,
  onSelectChar,
  sessionId,
  onRelationshipChange,
}) {
  const canvasRef = useRef(null);
  const [positions, setPositions] = useState({});
  const [hoveredId, setHoveredId] = useState(null);
  const [draggingFrom, setDraggingFrom] = useState(null);
  const [dragLine, setDragLine] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Static circular layout (no force simulation)
  useEffect(() => {
    if (nodes.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;

    const staticPos = {};
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      staticPos[node.id] = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    });

    setPositions(staticPos);
  }, [nodes]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || Object.keys(positions).length === 0) return;

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear
    ctx.fillStyle = "hsl(220 20% 4%)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    edges.forEach((edge) => {
      const from = positions[edge.from];
      const to = positions[edge.to];
      if (!from || !to) return;

      ctx.globalAlpha = 0.3 + edge.weight * 0.1;
      ctx.strokeStyle =
        edge.weight > 0
          ? "hsl(120 70% 50%)"
          : "hsl(0 70% 50%)";
      ctx.lineWidth = 2 + Math.abs(edge.weight) * 0.5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Draw drag line if dragging
    if (dragLine) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "hsl(185 100% 50%)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(dragLine.from.x, dragLine.from.y);
      ctx.lineTo(dragLine.to.x, dragLine.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Draw nodes
    nodes.forEach((node) => {
      const pos = positions[node.id];
      if (!pos) return;

      const size = node.nodeSize || 30;
      const isSelected = selectedCharId === node.id;
      const hasConnection = edges.some(
        (e) =>
          (e.from === node.id && e.to === selectedCharId) ||
          (e.to === node.id && e.from === selectedCharId)
      );
      const isDraggingFrom = draggingFrom === node.id;

      // Node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);

      if (isDraggingFrom) {
        ctx.fillStyle = "hsl(185 100% 60%)";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "hsl(185 100% 80%)";
      } else if (isSelected) {
        ctx.fillStyle = "hsl(185 100% 50%)";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "hsl(185 100% 70%)";
      } else if (selectedCharId && hasConnection) {
        ctx.fillStyle = "hsl(185 100% 50% / 0.4)";
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "hsl(185 100% 50% / 0.7)";
      } else {
        ctx.fillStyle = "hsl(185 50% 20%)";
        ctx.lineWidth = 1;
        ctx.strokeStyle = "hsl(185 100% 50% / 0.4)";
      }

      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle =
        isSelected || (selectedCharId && hasConnection)
          ? "hsl(185 100% 80%)"
          : "hsl(185 100% 50%)";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.label.slice(0, 8), pos.x, pos.y);
    });
  }, [positions, nodes, edges, selectedCharId, dragLine, draggingFrom]);

  const getNodeAtPosition = (x, y) => {
    for (const node of nodes) {
      const pos = positions[node.id];
      if (!pos) continue;
      const size = node.nodeSize || 30;
      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (dist < size / 2 + 10) {
        return node;
      }
    }
    return null;
  };

  const handleCanvasMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = getNodeAtPosition(x, y);
    if (node && e.button === 0) {
      // Left click - select or start drag
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click to drag relationship line
        setDraggingFrom(node.id);
        setDragLine({ from: positions[node.id], to: { x, y } });
      } else {
        // Normal click to select
        onSelectChar(selectedCharId === node.id ? null : node.id);
      }
    }
  };

  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (draggingFrom) {
      setDragLine({ from: positions[draggingFrom], to: { x, y } });
    }

    let found = null;
    nodes.forEach((node) => {
      const pos = positions[node.id];
      if (!pos) return;
      const size = node.nodeSize || 30;
      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (dist < size / 2 + 10) {
        found = node.id;
      }
    });
    setHoveredId(found);
    canvas.style.cursor = draggingFrom
      ? "crosshair"
      : found
      ? "pointer"
      : "default";
  };

  const handleCanvasMouseUp = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (draggingFrom) {
      const targetNode = getNodeAtPosition(x, y);
      if (targetNode && targetNode.id !== draggingFrom) {
        // Show modal to add notes
        setModalData({
          fromId: draggingFrom,
          toId: targetNode.id,
          fromName: nodes.find((n) => n.id === draggingFrom)?.label,
          toName: targetNode.label,
        });
        setShowModal(true);
        setNotes("");
      }

      setDraggingFrom(null);
      setDragLine(null);
    }
  };

  const handleSaveRelationship = async () => {
    if (!modalData) return;
    setSaving(true);

    try {
      // Get existing relationship or create new one
      const existing = edges.find(
        (e) =>
          (e.from === modalData.fromId && e.to === modalData.toId) ||
          (e.from === modalData.toId && e.to === modalData.fromId)
      );

      const relationshipId = existing?.id;

      // Update or create relationship
      const relationshipData = {
        character_id: modalData.toId,
        session_id: sessionId,
        score: existing?.score ?? 0,
      };

      if (relationshipId) {
        await base44.entities.CharacterRelationship.update(
          relationshipId,
          relationshipData
        );
      } else {
        await base44.entities.CharacterRelationship.create(relationshipData);
      }

      // Add memory log for both characters
      const fromChar = nodes.find((n) => n.id === modalData.fromId);
      const toChar = nodes.find((n) => n.id === modalData.toId);

      const memory = `Relationship adjusted: ${notes || "Manual connection established"}`;

      await Promise.all([
        base44.entities.CharacterMemory.create({
          character_id: modalData.fromId,
          fact: `Relationship with ${toChar?.label} changed: ${memory}`,
          category: "relationship",
          tags: ["relationship-change"],
        }),
        base44.entities.CharacterMemory.create({
          character_id: modalData.toId,
          fact: `Relationship with ${fromChar?.label} changed: ${memory}`,
          category: "relationship",
          tags: ["relationship-change"],
        }),
      ]);

      setShowModal(false);
      setModalData(null);
      setNotes("");
      onRelationshipChange?.();
      setSaving(false);
    } catch (err) {
      console.error("Error saving relationship:", err);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="w-full h-full relative">
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => {
            setHoveredId(null);
            if (!draggingFrom && canvasRef.current) {
              canvasRef.current.style.cursor = "default";
            }
          }}
          className="w-full h-full block"
        />

        {/* Help Text */}
        <div className="absolute bottom-4 left-4 text-[8px] font-mono text-primary/40 bg-black/60 border border-primary/20 rounded p-2 max-w-xs">
          <p>Click nodes to select • Ctrl+drag to create/edit relationships</p>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && modalData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-background border border-primary/30 rounded"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-primary/20">
                <h2 className="font-mono text-sm text-primary tracking-widest uppercase">
                  Update Relationship
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-primary/30 hover:text-primary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <div>
                  <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase mb-2">
                    Connection
                  </p>
                  <p className="font-mono text-sm text-primary/80">
                    {modalData.fromName} ↔ {modalData.toName}
                  </p>
                </div>

                <div>
                  <label className="text-[9px] font-mono text-primary/40 tracking-widest uppercase block mb-2">
                    Why Did This Change?
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g., They reconciled after the argument, or trust was broken..."
                    rows={4}
                    className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[9px] px-3 py-2 focus:outline-none focus:border-primary/40 transition-colors resize-none"
                  />
                </div>

                <p className="text-[8px] font-mono text-primary/50">
                  This will automatically update both characters' memory logs.
                </p>
              </div>

              {/* Footer */}
              <div className="flex gap-3 p-4 border-t border-primary/20">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-3 py-2 border border-primary/20 text-primary/40 hover:text-primary/60 font-mono text-[9px] tracking-widest uppercase transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRelationship}
                  disabled={saving}
                  className="flex-1 px-3 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}