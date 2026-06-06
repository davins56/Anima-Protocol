/**
 * Vercel edge proxy: forwards /api/* to Replit with the public site hostname so
 * Clerk JWT verification uses clerk.{www.anima-protocol.com}, not replit.app.
 * Takes precedence over vercel.json external rewrites.
 */
export const config = {
  runtime: "edge",
};

const UPSTREAM = "https://anima-protocol.replit.app";

export default async function handler(request) {
  const url = new URL(request.url);
  const upstream = new URL(url.pathname + url.search, UPSTREAM);

  const headers = new Headers(request.headers);
  const publicHost = url.host;
  headers.set("x-forwarded-host", publicHost);
  headers.set("x-anima-public-host", publicHost);
  headers.set("x-forwarded-proto", "https");
  if (!headers.has("origin")) {
    headers.set("origin", `https://${publicHost}`);
  }

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const response = await fetch(upstream.toString(), init);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
