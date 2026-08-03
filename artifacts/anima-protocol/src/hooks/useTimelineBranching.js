import { useCallback } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Hook to manage timeline branching when creating new chat sessions
 * Automatically creates WorldSnapshot records for new sessions
 */
export const useTimelineBranching = () => {
  const createBranchForSession = useCallback(async (session, characters, mode) => {
    try {
      const characterNames = mode === "solo"
        ? characters.find(c => c.id === session.character_id)?.name || "Character"
        : characters
            .filter(c => session.group_character_ids?.includes(c.id))
            .map(c => c.name)
            .join(", ");

      await base44.entities.WorldSnapshot.create({
        session_id: session.id,
        branch_name: `Universe: ${session.title}`,
        decision_point: `New reality forged with ${characterNames}`,
        world_state: {
          created_as_new_session: true,
          character_names: characterNames,
          mode,
          session_id: session.id,
        },
        relationship_snapshots: [],
        outcome_summary: `A new timeline emerges where ${characterNames} embarks on a different path.`,
        is_active: true,
        depth: 0,
      });
    } catch (err) {
      console.error("Error creating timeline snapshot:", err);
    }
  }, []);

  return { createBranchForSession };
};