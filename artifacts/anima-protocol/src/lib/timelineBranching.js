import { base44 } from "@/api/base44Client";

/**
 * Creates a timeline branch snapshot when a new chat session is created
 * This represents the session as a separate universe/reality
 */
export const createTimelineBranch = async (session, characters, mode) => {
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
};

/**
 * Links related sessions as branching timelines
 * Used when creating sessions with the same character(s) to show branching paths
 */
export const linkTimelineBranches = async (parentSessionId, childSessionId) => {
  try {
    const childSnapshot = await base44.entities.WorldSnapshot.filter({
      session_id: childSessionId,
    });

    if (childSnapshot?.length > 0) {
      await base44.entities.WorldSnapshot.update(childSnapshot[0].id, {
        parent_snapshot_id: parentSessionId,
      });
    }
  } catch (err) {
    console.error("Error linking timeline branches:", err);
  }
};