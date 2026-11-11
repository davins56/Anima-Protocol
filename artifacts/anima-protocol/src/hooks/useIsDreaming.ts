/**
 * Read-only dreaming flag from the existing continuity API.
 *
 * 3D Visual can pass `isDreaming` into a vessel pose later. This hook does
 * not touch VesselCanvas, ChatHeader, or NetBattle.
 */
import { useCompanionContinuity } from "@/hooks/useCompanionContinuity";
import { isDreamingPresence } from "@/lib/dreamJournal";

type ContinuityApi = {
  continuity?: {
    load: (characterId: string, opts: { surface?: string; name?: string }) => Promise<unknown>;
  };
};

export function useIsDreaming(
  characterId: string | null | undefined,
  opts: { surface?: string; name?: string; api?: ContinuityApi } = {},
) {
  const data = useCompanionContinuity(characterId, {
    surface: opts.surface || "home",
    name: opts.name || "",
    ...(opts.api ? { api: opts.api } : {}),
  });
  const presence = data?.presence ?? null;
  return {
    isDreaming: isDreamingPresence(presence),
    presence,
    presenceLabel: data?.presence_label ?? null,
    lastDreamAt: data?.state?.lastDreamAt ?? null,
    recentDreams: Array.isArray(data?.state?.recentDreams) ? data.state.recentDreams : [],
    ready: Boolean(data),
  };
}

export { isDreamingPresence as isDreaming };
