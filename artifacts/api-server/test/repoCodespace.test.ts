import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? "test-user",
  }),
}));

import repoCodespaceRouter, { resolveRepoPath } from "../src/routes/repoCodespace";

let server: Server;
let baseUrl = "";
let tempRepoDir = "";

beforeAll(async () => {
  // Create a temporary directory acting as REPO_ROOT
  tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-codespace-test-"));
  process.env.REPO_ROOT = tempRepoDir;

  // Create sample files in temp repo
  await fs.mkdir(path.join(tempRepoDir, "src"), { recursive: true });
  await fs.writeFile(path.join(tempRepoDir, "src", "index.ts"), "console.log('hello');");
  await fs.writeFile(path.join(tempRepoDir, ".env"), "SECRET_KEY=12345");
  await fs.writeFile(path.join(tempRepoDir, ".env.local"), "SECRET_KEY=67890");

  await fs.mkdir(path.join(tempRepoDir, ".git"), { recursive: true });
  await fs.writeFile(path.join(tempRepoDir, ".git", "config"), "[core]");

  await fs.mkdir(path.join(tempRepoDir, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(tempRepoDir, "node_modules", "pkg", "index.js"), "module.exports={}");

  // Create a file outside REPO_ROOT and a symlink inside REPO_ROOT pointing to it
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-outside-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  await fs.writeFile(outsideFile, "OUTSIDE_SECRET");

  try {
    fsSync.symlinkSync(outsideFile, path.join(tempRepoDir, "symlink_outside.txt"));
  } catch {
    // Ignore symlink creation errors if OS/permissions restrict
  }

  // Create another directory next to tempRepoDir to test prefix matching (e.g., tempRepoDir + "-sibling")
  const siblingDir = tempRepoDir + "-sibling";
  await fs.mkdir(siblingDir, { recursive: true });
  await fs.writeFile(path.join(siblingDir, "stolen.txt"), "STOLEN");

  const app: Express = express();
  app.use(express.json());
  app.use("/repo-codespace", repoCodespaceRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.REPO_ROOT;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tempRepoDir) {
    await fs.rm(tempRepoDir, { recursive: true, force: true });
  }
});

async function call(
  method: string,
  routePath: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}${routePath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": "test-user",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("repoCodespace security and path resolution", () => {
  describe("resolveRepoPath helper", () => {
    it("allows valid relative paths inside repo root", () => {
      const resolved = resolveRepoPath("src/index.ts");
      expect(resolved).toBe(path.join(tempRepoDir, "src", "index.ts"));
    });

    it("rejects path traversal attempts with ../", () => {
      expect(() => resolveRepoPath("../../../etc/passwd")).toThrow(/traversal|forbidden/i);
    });

    it("rejects absolute paths pointing outside repo root", () => {
      expect(() => resolveRepoPath("/etc/passwd")).toThrow(/traversal|forbidden/i);
    });

    it("rejects paths targeting sibling directories with prefix overlap", () => {
      const siblingPath = tempRepoDir + "-sibling/stolen.txt";
      expect(() => resolveRepoPath(siblingPath)).toThrow(/traversal|forbidden/i);
    });

    it("rejects symlinks pointing outside repo root", () => {
      if (fsSync.existsSync(path.join(tempRepoDir, "symlink_outside.txt"))) {
        expect(() => resolveRepoPath("symlink_outside.txt")).toThrow(/traversal|forbidden/i);
      }
    });

    it("rejects sensitive files like .env and .git", () => {
      expect(() => resolveRepoPath(".env")).toThrow(/sensitive|forbidden|traversal/i);
      expect(() => resolveRepoPath(".env.local")).toThrow(/sensitive|forbidden|traversal/i);
      expect(() => resolveRepoPath(".git/config")).toThrow(/sensitive|forbidden|traversal/i);
      expect(() => resolveRepoPath("node_modules/pkg/index.js")).toThrow(/sensitive|forbidden|traversal/i);
    });
  });

  describe("API endpoints security", () => {
    it("allows reading valid source files", async () => {
      const res = await call("POST", "/repo-codespace/read-file", { path: "src/index.ts" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.content).toContain("hello");
    });

    it("blocks reading .env file", async () => {
      const res = await call("POST", "/repo-codespace/read-file", { path: ".env" });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/sensitive|forbidden|traversal/i);
    });

    it("blocks reading .git/config file", async () => {
      const res = await call("POST", "/repo-codespace/read-file", { path: ".git/config" });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/sensitive|forbidden|traversal/i);
    });

    it("blocks path traversal in read-file", async () => {
      const res = await call("POST", "/repo-codespace/read-file", { path: "../../etc/passwd" });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/traversal|forbidden/i);
    });

    it("blocks writing to .env file", async () => {
      const res = await call("POST", "/repo-codespace/write-file", { path: ".env", content: "HACKED=true" });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/sensitive|forbidden|traversal/i);
    });

    it("blocks deleting .git files", async () => {
      const res = await call("POST", "/repo-codespace/delete-file", { path: ".git/config" });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/sensitive|forbidden|traversal/i);
    });
  });
});
