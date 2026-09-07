import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isEchoLibrarySteward } from "@/lib/echoKeys/steward.js";
import {
  MEMORY_CRYSTAL_TYPE_IDS,
  normalizeMemoryCrystalTypes,
  storedCrystalTypesAreFull,
} from "@/lib/memoryCrystals";

/**
 * Persist steward-only unlock of every Memory Crystal milestone type.
 * Does not mint conversation crystals.
 */
export default function useMemoryCrystalTypes() {
  const { user, setUser } = useAuth();
  const steward = isEchoLibrarySteward(user);
  const [types, setTypes] = useState(() =>
    normalizeMemoryCrystalTypes(user?.settings?.memory_crystals, { grantAllTypes: steward }),
  );
  const upgradedRef = useRef(false);

  useEffect(() => {
    const grantAll = isEchoLibrarySteward(user);
    const normalized = normalizeMemoryCrystalTypes(user?.settings?.memory_crystals, {
      grantAllTypes: grantAll,
    });
    setTypes(normalized);
    if (!user?.id || !grantAll || upgradedRef.current) return;
    if (storedCrystalTypesAreFull(user?.settings?.memory_crystals, MEMORY_CRYSTAL_TYPE_IDS.length)) {
      return;
    }
    upgradedRef.current = true;
    base44.auth
      .updateMe({
        settings: {
          ...(user?.settings || {}),
          memory_crystals: normalized,
        },
      })
      .then((updated) => {
        if (setUser && updated) setUser(updated);
      })
      .catch((err) => {
        console.warn("[Anima] Memory crystal type grant failed:", err?.message || err);
        upgradedRef.current = false;
      });
  }, [user?.id, user?.email, user?.username, user?.settings?.memory_crystals, setUser]);

  return types;
}
