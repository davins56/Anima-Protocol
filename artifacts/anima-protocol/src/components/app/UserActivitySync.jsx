import { useAuth } from "@/lib/AuthContext";
import { useUserActivity } from "@/hooks/useUserActivity";

/**
 * App-wide presence clock so leaving Chat (or any screen) stamps the
 * last-activity time used by the home Waiting tile.
 */
export default function UserActivitySync() {
  const { user } = useAuth();
  useUserActivity({ userId: user?.id || user?.email || null });
  return null;
}
