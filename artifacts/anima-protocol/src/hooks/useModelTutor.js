import { useCallback, useEffect, useState } from "react";
import { animaApi } from "@/api/animaApi";
import { useAuth } from "@/lib/AuthContext";

// One status fetch shared by every chat bubble and the Settings panel.
const STATUS_TTL_MS = 60_000;
const NOT_STEWARD = { isSteward: false };
let cached = null;
let cachedAt = 0;
let inflight = null;

export function resetModelTutorCacheForTests() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}

/** GET /api/tutor/status, cached briefly. Non-stewards get `{ isSteward: false }`. */
export async function loadModelTutorStatus({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < STATUS_TTL_MS) return cached;
  if (!force && inflight) return inflight;
  inflight = Promise.resolve()
    .then(() => animaApi.tutor.status())
    .catch(() => NOT_STEWARD)
    .then((status) => {
      cached = status || NOT_STEWARD;
      cachedAt = Date.now();
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Model Tutor status for the signed-in user. `isSteward` gates every teach
 * affordance; the API refuses non-stewards anyway.
 *
 * Only accounts the app already treats as admins (the steward emails, plus
 * VITE_ADMIN_EMAILS) ask the server. Everyone else skips the call, so opening
 * Chat never costs them a steward lookup.
 */
export function useModelTutor() {
  const { user } = useAuth();
  const mayTeach = user?.role === "admin";
  const [status, setStatus] = useState(mayTeach ? cached : NOT_STEWARD);

  useEffect(() => {
    if (!mayTeach) {
      setStatus(NOT_STEWARD);
      return undefined;
    }
    let alive = true;
    loadModelTutorStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [mayTeach]);

  const refresh = useCallback(async () => {
    const next = await loadModelTutorStatus({ force: true });
    setStatus(next);
    return next;
  }, []);

  return { status, isSteward: status?.isSteward === true, refresh };
}
