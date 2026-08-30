import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { track } from "@/lib/analytics";
import {
  defaultEchoLibrary,
  normalizeEchoLibrary,
  validateEchoFolder,
  echoFolderStats,
} from "@/lib/echoKeys";

/**
 * Load and persist the steward's Echo Key library on the user profile.
 */
export default function useEchoLibrary() {
  const { user, setUser } = useAuth();
  const [library, setLibrary] = useState(() =>
    normalizeEchoLibrary(user?.settings?.echo_keys),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLibrary(normalizeEchoLibrary(user?.settings?.echo_keys));
  }, [user?.id, user?.settings?.echo_keys]);

  const persist = useCallback(
    async (next) => {
      const normalized = normalizeEchoLibrary(next);
      const check = validateEchoFolder(normalized.folder);
      if (!check.ok) {
        setError(check.errors[0] || "Folder is not legal.");
        return { ok: false, errors: check.errors };
      }
      setSaving(true);
      setError(null);
      try {
        const updated = await base44.auth.updateMe({
          settings: {
            ...(user?.settings || {}),
            echo_keys: normalized,
          },
        });
        if (setUser && updated) setUser(updated);
        setLibrary(normalized);
        const stats = echoFolderStats(normalized);
        track("echo_folder_saved", {
          folder_size: stats.folder_size,
          star_count: stats.star_count,
          mega_count: stats.mega_count,
        });
        return { ok: true, library: normalized };
      } catch (err) {
        const message = err?.message || "Could not save Echo Keys.";
        setError(message);
        return { ok: false, errors: [message] };
      } finally {
        setSaving(false);
      }
    },
    [setUser, user?.settings],
  );

  const resetFolder = useCallback(() => persist(defaultEchoLibrary()), [persist]);

  return { library, saving, error, persist, resetFolder, setError };
}
