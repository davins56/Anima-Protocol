import app from "./app";

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    return new Response("Worker entry point is alive", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  },
};
