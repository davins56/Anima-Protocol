import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

export function useRelationshipGraph(sessionId, characters, messages) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(false);
  const updateTimeoutRef = useRef(null);

  useEffect(() => {
    if (sessionId && characters && characters.length > 0) {
      loadRelationshipData();
    }
  }, [sessionId, characters?.length, messages?.length]);

  const loadRelationshipData = async () => {
    setLoading(true);
    try {
      // Fetch all relationship data for this session
      const relationships = await base44.entities.CharacterRelationship.filter(
        { session_id: sessionId },
        "-updated_date",
        500
      );

      // Create nodes from characters
      const nodeMap = {};
      characters.forEach((char) => {
        nodeMap[char.id] = {
          id: char.id,
          name: char.name,
          category: char.category || "other",
          avatar: char.avatar_url,
          x: Math.random() * 400 - 200,
          y: Math.random() * 400 - 200,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
        };
      });

      // Create edges from relationships
      const edgeMap = {};
      if (relationships && relationships.length > 0) {
        relationships.forEach((rel) => {
          const key = `${rel.character_id}`;
          edgeMap[key] = {
            source: sessionId ? "player" : rel.character_id,
            target: rel.character_id,
            score: rel.score || 0,
            tier: rel.tier || "neutral",
            strength: Math.abs(rel.score) / 100, // 0-1
            isPositive: rel.score > 0,
          };
        });
      }

      setNodes(Object.values(nodeMap));
      setEdges(Object.values(edgeMap));
    } catch (err) {
      console.error("Error loading relationship data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Refresh on message update with debounce
  useEffect(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      loadRelationshipData();
    }, 1000);

    return () => clearTimeout(updateTimeoutRef.current);
  }, [messages?.length]);

  return {
    nodes,
    edges,
    loading,
    refresh: loadRelationshipData,
  };
}