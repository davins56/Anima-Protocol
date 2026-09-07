import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isEchoLibrarySteward } from "@/lib/echoKeys/steward.js";
import {
  defaultFragmentLibrary,
  normalizeFragmentLibrary,
  storedFragmentLibraryIsFull,
} from "@/lib/energyFragments";

/**
 * Load and persist the signed-in operator's Energy Fragment library.
 * The Protocol steward (Dàvīn) is granted every catalog id; others keep starters.
 */
export default function useEnergyFragmentLibrary() {
  const { user, setUser } = useAuth();
  const steward = isEchoLibrarySteward(user);
  const [library, setLibrary] = useState(() =>
    normalizeFragmentLibrary(user?.settings?.energy_fragments, { grantFullLibrary: steward }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const persistRef = useRef(/** @type {((next: unknown) => Promise<unknown>) | null} */ (null));
  const upgradedRef = useRef(false);

  useEffect(() => {
    const grantFull = isEchoLibrarySteward(user);
    const normalized = normalizeFragmentLibrary(user?.settings?.energy_fragments, {
      grantFullLibrary: grantFull,
    });
    setLibrary(normalized);
    if (!user?.id || !grantFull || upgradedRef.current) return;
    if (storedFragmentLibraryIsFull(user?.settings?.energy_fragments, normalized.owned_ids.length)) {
      return;
    }
    upgradedRef.current = true;
    persistRef.current?.(normalized);
  }, [user?.id, user?.email, user?.role, user?.username, user?.settings?.energy_fragments]);

  const persist = useCallback(
    async (next) => {
      const grantFull = isEchoLibrarySteward(user);
      const normalized = normalizeFragmentLibrary(next, { grantFullLibrary: grantFull });
      setSaving(true);
      setError(null);
      try {
        const updated = await base44.auth.updateMe({
          settings: {
            ...(user?.settings || {}),
            energy_fragments: normalized,
          },
        });
        if (setUser && updated) setUser(updated);
        setLibrary(normalized);
        return { ok: true, library: normalized };
      } catch (err) {
        const message = err?.message || "Could not save Energy Fragments.";
        setError(message);
        return { ok: false, errors: [message] };
      } finally {
        setSaving(false);
      }
    },
    [setUser, user],
  );

  persistRef.current = persist;

  const resetFolder = useCallback(
    () => persist(defaultFragmentLibrary({}, { grantFullLibrary: isEchoLibrarySteward(user) })),
    [persist, user],
  );

  return { library, saving, error, persist, resetFolder, setError };
}
