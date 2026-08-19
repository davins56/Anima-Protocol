interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  [key: string]: unknown;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Serve API routes through the Express app (adapted for Workers)
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      // For now, return a minimal healthcheck; full Express adapter is TODO.
      if (
        url.pathname === "/api/healthz" ||
        url.pathname === "/api/healthz/"
      ) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ error: "Not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }

    // Everything else: serve static assets (SPA fallback handled by
    // assets.not_found_handling = "single-page-application" in wrangler.json)
    return env.ASSETS.fetch(request);
  },
};
