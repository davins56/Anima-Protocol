/**
 * Node / Cloud Run SPA serving. Worker and Vercel never import this module.
 *
 * Cloudflare Assets already SPA-fallback unmatched paths (including stale
 * hashed /assets/*.js). Mirror the Worker guard here: missing static files
 * are a real 404, client routes still get index.html.
 *
 * On Cloud Run the Node HTTP server must serve SPA *before* Express/Clerk.
 * Clerk middleware is mounted for every path in app.ts; the Worker never
 * sends `/characters` through Express (Assets handles it).
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import {
  HASHED_ASSET_CACHE_CONTROL,
  isStaticAssetPath,
} from "./spaAssetFallback";

const WORKER_OR_VERCEL_RUNTIMES = new Set([
  "worker",
  "cloudflare",
  "cloudflare-workers",
  "vercel",
  "serverless",
  "edge",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

export function resolveNodeSpaDir(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const runtime = (env.ANIMA_RUNTIME || "").trim().toLowerCase();
  if (WORKER_OR_VERCEL_RUNTIMES.has(runtime)) return null;
  const raw = (env.ANIMA_STATIC_DIR || "").trim();
  if (!raw) return null;
  const dir = path.resolve(raw);
  if (!fs.existsSync(path.join(dir, "index.html"))) return null;
  return dir;
}

export function shouldAttachNodeSpa(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(resolveNodeSpaDir(env));
}

export function skipApiOrClerkGateway(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/v1" ||
    pathname.startsWith("/v1/")
  );
}

function requestPathname(url: string | undefined): string {
  const raw = (url || "/").split("?")[0] ?? "/";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function safeJoin(dir: string, pathname: string): string | null {
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  const resolved = path.resolve(dir, `.${pathname}`);
  const root = path.resolve(dir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function sendPlain(
  res: ServerResponse,
  status: number,
  body: string,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

/**
 * Handle a non-API GET/HEAD from the Node HTTP wrapper. Returns true when
 * the response is finished so Express/Clerk must not run.
 */
export function tryServeNodeSpa(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dir = resolveNodeSpaDir(env);
  if (!dir) return false;
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const pathname = requestPathname(req.url);
  if (skipApiOrClerkGateway(pathname)) return false;

  if (isStaticAssetPath(pathname)) {
    const filePath = safeJoin(dir, pathname);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      sendPlain(res, 404, `Not Found: ${pathname}\n`);
      return true;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader(
      "Content-Type",
      MIME_BY_EXT[ext] || "application/octet-stream",
    );
    if (pathname.startsWith("/assets/")) {
      res.setHeader("Cache-Control", HASHED_ASSET_CACHE_CONTROL);
    }
    if (method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  const indexHtml = path.join(dir, "index.html");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(indexHtml).pipe(res);
  return true;
}

/**
 * Express middleware variant for tests. Production Cloud Run uses
 * `tryServeNodeSpa` on the HTTP server so Clerk never sees SPA routes.
 */
export function attachNodeSpaFallback(
  app: Express,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dir = resolveNodeSpaDir(env);
  if (!dir) return false;

  const indexHtml = path.join(dir, "index.html");

  app.use(
    express.static(dir, {
      index: false,
      fallthrough: true,
      setHeaders(res, filePath) {
        const relative = filePath.slice(dir.length).split(path.sep).join("/");
        const pathname = relative.startsWith("/") ? relative : `/${relative}`;
        if (pathname.startsWith("/assets/")) {
          res.setHeader("Cache-Control", HASHED_ASSET_CACHE_CONTROL);
        }
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      next();
      return;
    }
    const pathname = (req.path || "").split("?")[0] ?? "";
    if (skipApiOrClerkGateway(pathname)) {
      next();
      return;
    }
    if (isStaticAssetPath(pathname)) {
      res.status(404);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(`Not Found: ${pathname}\n`);
      return;
    }
    res.sendFile(indexHtml);
  });

  return true;
}
