import { pool, migrateUserData } from "@workspace/db";

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const fromEmail = readArg("--from") ?? readArg("--from-email");
  const toEmail = readArg("--to") ?? readArg("--to-email");
  const fromUserId = readArg("--from-user-id");
  const toUserId = readArg("--to-user-id");
  const dryRun = hasFlag("--dry-run");
  const charactersOnly = hasFlag("--characters-only");

  if (!fromEmail && !fromUserId) {
    throw new Error(
      "Usage: migrate-account --from davins56@hotmail.com --to davins56@gmail.com [--dry-run] [--characters-only]",
    );
  }
  if (!toEmail && !toUserId) {
    throw new Error("Provide --to <email> or --to-user-id <clerk_user_id>");
  }

  const entityNames = charactersOnly
    ? [
        "Character",
        "Anima",
        "ChatSession",
        "ChatMessage",
        "CharacterMemory",
        "CharacterJournal",
        "CharacterRelationship",
        "CharacterEmotionalState",
        "CharacterGroup",
      ]
    : undefined;

  const result = await migrateUserData({
    fromEmail: fromEmail ?? "",
    toEmail: toEmail ?? "",
    fromUserId,
    toUserId,
    entityNames,
    dryRun,
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[migrate-account] failed:", error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
