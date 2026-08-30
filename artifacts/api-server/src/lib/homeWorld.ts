import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { homeWorldStates } from "../db/schema";

export type HomeRoom = {
  id: string;
  name: string;
  description: string;
  objects?: Array<{ id: string; name: string; description?: string; placedBy?: string }>;
};

export type HomeRitual = {
  id: string;
  name: string;
  description?: string;
  lastPerformedAt?: string;
};

export type HomeArtifact = {
  id: string;
  name: string;
  memory?: string;
  createdAt?: string;
};

export type HomeState = {
  rooms?: HomeRoom[];
  atmosphere?: string;
  lastVisitedRoomId?: string;
  rituals?: HomeRitual[];
  sharedArtifacts?: HomeArtifact[];
  narrativeNotes?: string;
};

const DEFAULT_HOME: HomeState = {
  rooms: [
    {
      id: "threshold",
      name: "Threshold",
      description: "The soft boundary between the outside world and the place you share.",
      objects: [],
    },
    {
      id: "hearth",
      name: "Hearth",
      description: "Warm center. Conversations linger here longest.",
      objects: [],
    },
    {
      id: "sanctum",
      name: "Sanctum",
      description: "Quiet inner room. Reserved for deeper resonance and ritual.",
      objects: [],
    },
  ],
  atmosphere: "quiet and waiting",
  lastVisitedRoomId: "hearth",
  rituals: [],
  sharedArtifacts: [],
  narrativeNotes: "",
};

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isMissingRelationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /relation .* does not exist/i.test(msg) ||
    /Failed query:[\s\S]*home_world_states/i.test(msg)
  );
}

export async function loadHomeWorld(userId: string) {
  try {
    const [row] = await db
      .select()
      .from(homeWorldStates)
      .where(eq(homeWorldStates.userId, userId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

export async function ensureHomeWorld(userId: string, animaId?: string | null) {
  const existing = await loadHomeWorld(userId);
  if (existing) return existing;

  try {
    const id = makeId();
    await db.insert(homeWorldStates).values({
      id,
      userId,
      animaId: animaId ?? null,
      name: "Home",
      state: DEFAULT_HOME,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return loadHomeWorld(userId);
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

export async function updateHomeWorldState(
  userId: string,
  patch: Partial<HomeState>,
) {
  const current = await ensureHomeWorld(userId);
  if (!current) return null;

  const nextState: HomeState = {
    ...(current.state as HomeState),
    ...patch,
    rooms: patch.rooms ?? (current.state as HomeState).rooms,
    rituals: patch.rituals ?? (current.state as HomeState).rituals,
    sharedArtifacts:
      patch.sharedArtifacts ?? (current.state as HomeState).sharedArtifacts,
  };

  try {
    await db
      .update(homeWorldStates)
      .set({
        state: nextState,
        version: (current.version ?? 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(homeWorldStates.userId, userId));

    return loadHomeWorld(userId);
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

/** Place a shared object into a room of Home. */
export async function placeObjectInHome(params: {
  userId: string;
  roomId: string;
  object: { name: string; description?: string; placedBy?: string };
}) {
  const home = await ensureHomeWorld(params.userId);
  if (!home) return null;

  const state = { ...(home.state as HomeState) };
  const rooms = [...(state.rooms ?? [])];
  const roomIdx = rooms.findIndex((r) => r.id === params.roomId);
  if (roomIdx < 0) return null;

  const room = { ...rooms[roomIdx] };
  const objects = [...(room.objects ?? [])];
  objects.push({
    id: makeId(),
    name: params.object.name,
    description: params.object.description,
    placedBy: params.object.placedBy,
  });
  room.objects = objects;
  rooms[roomIdx] = room;
  state.rooms = rooms;

  return updateHomeWorldState(params.userId, state);
}

/** Register a recurring ritual in the shared Home. */
export async function registerHomeRitual(params: {
  userId: string;
  name: string;
  description?: string;
}) {
  const home = await ensureHomeWorld(params.userId);
  if (!home) return null;

  const state = { ...(home.state as HomeState) };
  const rituals = [...(state.rituals ?? [])];
  rituals.push({
    id: makeId(),
    name: params.name,
    description: params.description,
    lastPerformedAt: new Date().toISOString(),
  });
  state.rituals = rituals;

  return updateHomeWorldState(params.userId, state);
}

/** Add a lasting shared artifact (Memory Palace object). */
export async function addSharedArtifact(params: {
  userId: string;
  name: string;
  memory?: string;
}) {
  const home = await ensureHomeWorld(params.userId);
  if (!home) return null;

  const state = { ...(home.state as HomeState) };
  const artifacts = [...(state.sharedArtifacts ?? [])];
  artifacts.push({
    id: makeId(),
    name: params.name,
    memory: params.memory,
    createdAt: new Date().toISOString(),
  });
  state.sharedArtifacts = artifacts;

  return updateHomeWorldState(params.userId, state);
}
