import { db, pool, backfillChatMessages } from "@workspace/db";

// One-time (idempotent) backfill runner. Migrates every user's legacy
// ChatSession.messages blobs into ChatMessage rows so metadata-only session
// lists stop shipping full chat history over the wire, without waiting for each
// chat to be reopened. Safe to run repeatedly: already-migrated sessions are
// skipped. Wired into the post-merge setup script so it runs automatically.
async function main(): Promise<void> {
  const start = Date.now();
  const { scanned, migrated } = await backfillChatMessages(db);
  const ms = Date.now() - start;
  console.log(
    `[backfill-chat-messages] migrated ${migrated} of ${scanned} unmigrated session(s) in ${ms}ms`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfill-chat-messages] failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
