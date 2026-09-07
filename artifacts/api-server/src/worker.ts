interface WorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Worker entry point is alive", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  },
};
