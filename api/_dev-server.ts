/**
 * Lightweight dev server for Vercel-style API routes.
 * Run: npx tsx api/_dev-server.ts
 * Loads .env.local for OPENAI_API_KEY, serves on port 3001.
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath: string) {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* file not found, skip */ }
}

loadEnvFile(resolve(import.meta.dirname, "..", ".env.local"));
loadEnvFile(resolve(import.meta.dirname, "..", ".env"));

const PORT = Number(process.env.API_DEV_PORT) || 3001;

type Handler = (req: { method: string; body: Record<string, unknown> }, res: {
  status: (code: number) => { json: (data: unknown) => void };
}) => Promise<void>;

const routes: Record<string, () => Promise<{ default: Handler }>> = {
  "/api/chat":           () => import("./chat.js"),
  "/api/character-init": () => import("./character-init.js"),
};

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = req.url?.split("?")[0] ?? "";
  const loader = routes[url];
  if (!loader) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }

  const body = await parseBody(req);
  const mod = await loader();

  const mockReq = { method: req.method ?? "GET", body };
  const mockRes = {
    status: (code: number) => ({
      json: (data: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      },
    }),
  };

  try {
    await mod.default(mockReq as Parameters<Handler>[0], mockRes as Parameters<Handler>[1]);
  } catch (err) {
    console.error("Handler error:", err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`API dev server running on http://localhost:${PORT}`);
});
