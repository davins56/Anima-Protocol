/**
 * Set or clear settings.adult_content_enabled on the user's profile without
 * replacing the rest of the record. Used by the age-attestation and revoke
 * routes so the flag is persisted server-side immediately.
 */
import { eq } from "drizzle-orm";
import { db, userProfiles, withTransientDbRetry } from "@workspace/db";

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export async function setProfileAdultContentEnabled(
  userId: string,
  enabled: boolean,
): Promise<void> {
  await withTransientDbRetry(async () => {
    const [row] = await db
      .select({ data: userProfiles.data })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    const data = isRecord(row?.data) ? { ...row.data } : {};
    const settings = isRecord(data.settings) ? { ...data.settings } : {};
    const next = { ...data, settings: { ...settings, adult_content_enabled: enabled } };
    await db
      .insert(userProfiles)
      .values({ userId, data: next })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { data: next, updatedAt: new Date() },
      });
  });
}
