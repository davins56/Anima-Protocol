import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import { logger } from "../lib/logger";
import {
  CLERK_PROXY_PATH,
  canonicalClerkProxyHeaderHost,
  getClerkProxyHost,
  isLocalDevHost,
} from "./clerkProxyHosts";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
const UPSTREAM_TIMEOUT_MS = 25_000;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function normalizeHostname(host: string | undefined): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

export function resolveClerkUpstreamUrl(requestUrl: string | undefined): URL {
  const path = requestUrl?.startsWith("/") ? requestUrl : `/${requestUrl ?? ""}`;
  return new URL(path, CLERK_FAPI);
}

export function buildClerkProxyHeaderValues(
  req: { headers: IncomingHttpHeaders },
  secretKey: string,
): { proxyUrl: string; origin: string; host: string } {
  const requestHost = normalizeHostname(getClerkProxyHost(req) || "");
  const usePublicProxy =
    isLocalDevHost(requestHost) &&
    process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_");

  const protocol = usePublicProxy
    ? "https"
    : (req.headers["x-forwarded-proto"] as string) || "https";
  const host = usePublicProxy
    ? "www.anima-protocol.com"
    : canonicalClerkProxyHeaderHost(getClerkProxyHost(req));

  const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}/`;
  const origin = host ? `${protocol}://${host}` : "";

  return { proxyUrl, origin, host };
}

function clientIpFromHeaders(headers: IncomingHttpHeaders): string {
  const xff = headers["x-forwarded-for"];
  return (
    (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
    (typeof headers["x-real-ip"] === "string" ? headers["x-real-ip"] : "") ||
    ""
  );
}

export function buildClerkUpstreamHeaders(
  req: { headers: IncomingHttpHeaders; method?: string },
  secretKey: string,
): Headers {
  const { proxyUrl, origin } = buildClerkProxyHeaderValues(req, secretKey);
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "content-length" && req.method === "GET") continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }

  headers.set("Clerk-Proxy-Url", proxyUrl);
  headers.set("Clerk-Secret-Key", secretKey);
  headers.set("Host", "frontend-api.clerk.dev");
  if (origin) {
    headers.set("Origin", origin);
  }

  const clientIp = clientIpFromHeaders(req.headers);
  if (clientIp) {
    headers.set("X-Forwarded-For", clientIp);
  }

  return headers;
}

async function readRequestBody(
  req: IncomingMessage,
): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

function forwardResponseHeaders(
  upstream: Response,
  res: ServerResponse,
): void {
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    res.setHeader(name, value);
  });
}

export async function proxyClerkWithFetch(
  req: IncomingMessage,
  res: ServerResponse,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const upstreamUrl = resolveClerkUpstreamUrl(req.url);
  const headers = buildClerkUpstreamHeaders(req, secretKey);
  const body = await readRequestBody(req);

  const upstream = await fetchImpl(upstreamUrl, {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  res.statusCode = upstream.status;
  forwardResponseHeaders(upstream, res);

  const payload = Buffer.from(await upstream.arrayBuffer());
  res.end(payload);
}

export async function handleClerkProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  secretKey: string,
): Promise<void> {
  try {
    await proxyClerkWithFetch(req, res, secretKey);
  } catch (err) {
    logger.error({ err, url: req.url }, "Clerk proxy upstream fetch failed");
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: "clerk_proxy_upstream_failed",
          message:
            err instanceof Error
              ? err.message
              : "Could not reach Clerk Frontend API",
        }),
      );
    }
  }
}
