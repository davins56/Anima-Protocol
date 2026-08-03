// Page-level "Restore From Backup" flow for the Settings page, extracted so the
// destructive write path (merge vs replace) can be unit tested without rendering
// the whole Settings component.
//
// This is the most dangerous flow in the app: "Replace Everything" wipes the
// user's account before inserting the backup, so a regression here could erase
// data without restoring it. Keeping the orchestration here (and the merge/
// replace semantics on the server inside a transaction) lets a test exercise
// both modes — and a mid-restore failure — against a mocked base44 backend.

import { restoreData } from "@/api/base44Client";

// Run the staged restore in the chosen mode.
//
// deps:
//   pendingRestore    — the staged { entities, profile } payload (no-op if null)
//   setRestoring      — toggles the in-progress flag around the network call
//   setRestoreResult  — surfaces the success summary or a friendly error
//   setPendingRestore — cleared on success so the confirm dialog closes
//   setConfirmReplace — resets the second "replace" confirm step on success
//   loadStats         — refresh the on-page record counts after a restore
//   loadUser          — refresh the on-page profile after a restore
export async function performRestoreFlow(
  mode,
  {
    pendingRestore,
    setRestoring,
    setRestoreResult,
    setPendingRestore,
    setConfirmReplace,
    loadStats,
    loadUser,
  },
) {
  if (!pendingRestore) return;
  setRestoring(true);
  setRestoreResult(null);
  try {
    const result = await restoreData(
      { entities: pendingRestore.entities, profile: pendingRestore.profile },
      mode,
    );
    setRestoreResult({
      ok: true,
      count: result?.count || 0,
      mode,
    });
    setPendingRestore(null);
    setConfirmReplace(false);
    await Promise.all([loadStats(), loadUser()]);
  } catch (err) {
    console.error("Restore failed:", err);
    setRestoreResult({ ok: false, message: err?.message || "Restore failed" });
  } finally {
    setRestoring(false);
  }
}
