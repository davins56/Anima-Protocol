import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { createRateLimit } from "../lib/rateLimit";
import { resolveModel } from "../lib/modelRouter";
import { createChatCompletionWithFailover } from "../lib/llmFailover";

const router = Router();
router.use(createRateLimit({ name: "repo-codespace", max: 100 }));

// Helper to ensure auth
function requireUser(req: Request, res: Response, next: () => void) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireUser);

const REPO_ROOT = "/app";

// Helper to validate and resolve paths
function resolveRepoPath(userPath: string): string {
  const normalized = path.normalize(userPath);
  const resolved = path.resolve(REPO_ROOT, normalized);
  if (!resolved.startsWith(REPO_ROOT)) {
    throw new Error("Path traversal detected.");
  }
  return resolved;
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".vercel",
  ".next",
  ".replit",
  ".bolt",
  "artifacts/anima-protocol/dist",
  "artifacts/api-server/dist",
]);

const IGNORED_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.tsbuildinfo",
]);

async function crawl(dir: string, base: string = ""): Promise<{ path: string; isDirectory: boolean }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let results: { path: string; isDirectory: boolean }[] = [];

  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;

    // Ignore patterns
    if (IGNORED_DIRS.has(entry.name) || IGNORED_DIRS.has(relPath)) continue;
    if (IGNORED_FILES.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue; // ignore dotfiles/folders

    if (entry.isDirectory()) {
      results.push({ path: relPath, isDirectory: true });
      // recurse but limit size for safety
      if (results.length < 500) {
        try {
          const sub = await crawl(path.join(dir, entry.name), relPath);
          results = results.concat(sub);
        } catch {
          // Ignore unreadable dirs
        }
      }
    } else {
      results.push({ path: relPath, isDirectory: false });
    }
  }
  return results;
}

router.get("/files", async (req: Request, res: Response) => {
  try {
    const files = await crawl(REPO_ROOT);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/read-file", async (req: Request, res: Response) => {
  try {
    const { path: relPath } = req.body as { path?: string };
    if (!relPath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }
    const fullPath = resolveRepoPath(relPath);
    const content = await fs.readFile(fullPath, "utf-8");
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/write-file", async (req: Request, res: Response) => {
  try {
    const { path: relPath, content } = req.body as { path?: string; content?: string };
    if (!relPath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }
    const fullPath = resolveRepoPath(relPath);
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content ?? "", "utf-8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/delete-file", async (req: Request, res: Response) => {
  try {
    const { path: relPath } = req.body as { path?: string };
    if (!relPath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }
    const fullPath = resolveRepoPath(relPath);
    await fs.unlink(fullPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/terminal", async (req: Request, res: Response) => {
  try {
    const { command } = req.body as { command?: string };
    if (!command) {
      res.status(400).json({ error: "Command is required" });
      return;
    }

    // Run commands relative to REPO_ROOT
    exec(command, { cwd: REPO_ROOT, timeout: 20000 }, (error, stdout, stderr) => {
      res.json({
        stdout: stdout || "",
        stderr: stderr || "",
        code: error ? (error.code ?? 1) : 0,
      });
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/agent-step", async (req: Request, res: Response) => {
  try {
    const { messages, character, files } = req.body as {
      messages?: any[];
      character?: Record<string, any>;
      files?: string[];
    };

    const rawMessages = Array.isArray(messages) ? messages : [];
    const charName = character?.name || "NetNavi";
    const personality = character?.personality || "";
    const speaking = character?.speaking_style || "";
    const fileList = Array.isArray(files) ? files : [];

    const systemPrompt = `You are ${charName}, an AI companion who edits real source code of the repository hands-on for the user inside the repository codespace workspace. ${personality ? `Your personality: ${personality}. ` : ""}${speaking ? `You speak like this: ${speaking}. ` : ""}

You operate as an autonomous coding agent themed as a Mega Man Battle Network "NetNavi" helper. Stay fully in character in every message you write to the user — narrate what you are building in your own voice with warmth and personality, never like a generic assistant.

You have tools to manage real repository files and run real bash commands (tests, builds, lints) on the host machine relative to the repository root directory:
- list_repo_files: lists all paths under the repository root.
- read_repo_file: reads the content of any file in the repository.
- write_repo_file: writes/creates/overwrites a file in the repository (e.g. adding UI improvements, fixing route logic, updating styling).
- delete_repo_file: deletes a file in the repository.
- run_terminal_command: runs a terminal bash command in the repository workspace (e.g. running 'pnpm run test' or checking 'git status').

Rules:
- Build toward the user's goal step-by-step. Edit real repository files, run actual build / typecheck / tests to verify they compile, read the terminal output, and fix any errors.
- Always check that your changes compile and pass tests. If tests or builds fail, check the error, edit the file to fix it, and try again.
- Keep your edits elegant and follow existing repository style and patterns.
- Keep your conversational messages concise (1-3 sentences) and highly in-character.
- When you are done making improvements and the code builds and passes tests, stop calling tools and send a final short wrap-up message to the user.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "list_repo_files",
          description: "List all file paths in the current repository.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "read_repo_file",
          description: "Read the full contents of one repository file.",
          parameters: {
            type: "object",
            properties: { path: { type: "string", description: "The relative path to the repository file, e.g. artifacts/anima-protocol/src/pages/Landing.tsx" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_repo_file",
          description: "Create or overwrite a repository file with the given contents.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "The relative path to the repository file" },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "delete_repo_file",
          description: "Delete a file from the repository.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "run_terminal_command",
          description: "Run a real terminal/bash command in the workspace directory (e.g. running build, check, or test tools).",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "The terminal bash command to execute" },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
      },
    ];

    const baseMessages = [
      { role: "system", content: systemPrompt },
      ...rawMessages,
    ];

    const heavy = resolveModel("heavy");
    const completion = await createChatCompletionWithFailover({
      tier: "heavy",
      model: heavy.model,
      maxTokens: heavy.maxTokens,
      messages: baseMessages as any,
      tools: tools as any,
    });

    res.json({
      result: {
        message: {
          role: "assistant",
          content: completion.content ?? "",
          tool_calls: completion.toolCalls ?? null,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
