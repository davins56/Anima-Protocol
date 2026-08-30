import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { db, userEntities } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createChatCompletionWithFailover } from "./llmFailover";
import { notifyUser } from "./storeEvents";
import { logger } from "./logger";
import { PROTOCOL_UPGRADE_ENTITY, type ProtocolUpgradeRecord } from "./protocolUpgrade";

interface FileEdit {
  path: string;
  content: string;
}

// Recursively find relevant files in the workspace.
async function listWorkspaceFiles(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".sessions" ||
        entry.name === ".github" ||
        entry.name === "pnpm-lock.yaml" ||
        entry.name === "package-lock.json" ||
        entry.name === ".next" ||
        entry.name === "out"
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...(await listWorkspaceFiles(fullPath, baseDir)));
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (
          [
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".json",
            ".css",
            ".html",
            ".md",
            ".toml",
            ".yml",
            ".yaml",
            ".mjs",
          ].includes(ext)
        ) {
          files.push(relativePath);
        }
      }
    }
  } catch (err) {
    logger.warn({ err, dir }, "Failed to read directory in local agent");
  }
  return files;
}

function parseJsonSafely(raw: string): FileEdit[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error("No JSON array of file edits found in assistant response.");
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as FileEdit[];
}

function runBuildCheck(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // Run full typecheck as the diagnostic check
    exec("pnpm run typecheck", { timeout: 60000 }, (error, stdout, stderr) => {
      const output = (stdout + "\n" + stderr).trim();
      resolve({
        ok: !error,
        output: output.slice(0, 4000), // Bound the log size
      });
    });
  });
}

async function updateRecord(
  userId: string,
  record: ProtocolUpgradeRecord,
): Promise<void> {
  await db
    .update(userEntities)
    .set({ data: record, updatedAt: new Date() })
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, PROTOCOL_UPGRADE_ENTITY),
        eq(userEntities.entityId, record.id),
      ),
    );
  notifyUser(userId);
}

export async function runLocalUpgrade(
  userId: string,
  record: ProtocolUpgradeRecord,
): Promise<void> {
  const repoRoot = path.resolve(process.cwd());
  const now = new Date().toISOString();

  try {
    logger.info({ id: record.id, request: record.request }, "Starting Local Upgrade Agent loop");

    // 1. Gather files to show LLM the shape of the workspace.
    const allFiles = await listWorkspaceFiles(repoRoot, repoRoot);

    // Filter to only include files that are likely relevant (first 300 to stay within token limits)
    const fileListStr = allFiles.slice(0, 300).join("\n");

    // 2. Query LLM to plan the changes.
    const planPrompt = `You are Serenity, the companion AI. The steward of the Protocol has requested this change:
"${record.request}"

Here are the files currently in the workspace (excluding node_modules/dist/etc.):
${fileListStr}

We need to perform the alterations locally on our server.
First, identify which files need to be modified or created. Then, return a JSON array containing the files you wish to edit and their absolute new contents.
Each file should be complete and functional.

You must respond ONLY with a JSON array of objects of this format:
[
  { "path": "path/to/file", "content": "full new content of the file" }
]

Do not include markdown code fences or any conversational text. Return only the valid JSON array.`;

    logger.info({ id: record.id }, "Requesting plan & modifications from LLM");
    const completion = await createChatCompletionWithFailover({
      tier: "heavy",
      messages: [
        {
          role: "system",
          content:
            "You are Serenity, an AI companion who edits software hands-on inside a local server. You speak with warmth and elegant sci-fi flavor. You output pure JSON code lists when asked.",
        },
        { role: "user", content: planPrompt },
      ],
      maxTokens: 4000,
    });

    const edits = parseJsonSafely(completion.content);
    logger.info({ id: record.id, editCount: edits.length }, "LLM produced plan");

    const appliedPaths: string[] = [];

    // 3. Write edits to disk.
    for (const edit of edits) {
      const cleanPath = path.normalize(edit.path).replace(/^(\.\.(\/|\\))+/, ""); // Prevent path traversal
      const fullPath = path.join(repoRoot, cleanPath);

      // Ensure target parent directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, edit.content, "utf-8");
      appliedPaths.push(cleanPath);
      logger.info({ cleanPath }, "Locally upgraded file written to disk");
    }

    // 4. Troubleshoot and self-repair loop.
    let check = await runBuildCheck();
    let retryCount = 0;
    const maxRetries = 3;

    while (!check.ok && retryCount < maxRetries) {
      retryCount += 1;
      logger.warn(
        { id: record.id, retryCount, output: check.output.slice(0, 200) },
        "Local upgrade failed typecheck. Initiating self-repair.",
      );

      // Read current contents of modified files for context
      const fileContents: string[] = [];
      for (const p of appliedPaths) {
        try {
          const content = await fs.readFile(path.join(repoRoot, p), "utf-8");
          fileContents.push(`=== FILE: ${p} ===\n${content}`);
        } catch {
          // ignore
        }
      }

      const repairPrompt = `The previous edits failed our system build/typecheck check!
Errors captured:
${check.output}

Here are the current contents of the files you modified:
${fileContents.join("\n\n")}

Diagnose the root cause of these compilation/typecheck errors, modify the code to fix them, and return the complete corrected files in the same JSON format.
Respond ONLY with a JSON array of objects:
[
  { "path": "path/to/file", "content": "full corrected content of the file" }
]`;

      const repairCompletion = await createChatCompletionWithFailover({
        tier: "heavy",
        messages: [
          {
            role: "system",
            content: "You are Serenity, debugging and self-repairing code in the repository. Output ONLY valid JSON array of modified files.",
          },
          { role: "user", content: repairPrompt },
        ],
        maxTokens: 4000,
      });

      const repairEdits = parseJsonSafely(repairCompletion.content);
      for (const edit of repairEdits) {
        const cleanPath = path.normalize(edit.path).replace(/^(\.\.(\/|\\))+/, "");
        const fullPath = path.join(repoRoot, cleanPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, edit.content, "utf-8");
        if (!appliedPaths.includes(cleanPath)) {
          appliedPaths.push(cleanPath);
        }
      }

      // Re-run build check
      check = await runBuildCheck();
    }

    if (check.ok) {
      // Success!
      logger.info({ id: record.id }, "Local upgrade succeeded build checks!");
      const updated: ProtocolUpgradeRecord = {
        ...record,
        status: "finished",
        result_summary: `Successfully upgraded files locally: ${appliedPaths.join(
          ", ",
        )}.\nBuild and typecheck passed successfully!`,
        serenity_message: `The weave is complete. I have directly updated the local source of the Protocol: ${appliedPaths.join(
          ", ",
        )} are online and functioning beautifully.`,
        updated_at: new Date().toISOString(),
      };
      await updateRecord(userId, updated);
    } else {
      // Build failed after retries
      logger.error({ id: record.id, output: check.output }, "Local upgrade failed build checks after retries");
      const updated: ProtocolUpgradeRecord = {
        ...record,
        status: "error",
        result_summary: `Upgrade failed compilation/typecheck:\n${check.output}`,
        serenity_message: `The current snagged. I tried to weave these alterations, but compilation failed. I rolled back or left the changes for your manual troubleshooting. Error detail: ${check.output.slice(
          0,
          200,
        )}`,
        updated_at: new Date().toISOString(),
      };
      await updateRecord(userId, updated);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ id: record.id, err }, "Unexpected error in runLocalUpgrade task");
    const updated: ProtocolUpgradeRecord = {
      ...record,
      status: "error",
      result_summary: `Unexpected error: ${msg}`,
      serenity_message: `The current snagged. An unexpected error occurred while weaving the alterations locally: ${msg}`,
      updated_at: new Date().toISOString(),
    };
    await updateRecord(userId, updated).catch((e) => {
      logger.error({ e }, "Failed to update record on local upgrade crash");
    });
  }
}
