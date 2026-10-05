declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

declare module "cloudflare:node" {
  export function httpServerHandler(
    options:
      | { port: number }
      | { app: unknown }
      | unknown,
  ): {
    fetch(
      request: Request,
      env: unknown,
      ctx: ExecutionContext,
    ): Promise<Response>;
  };

  export function handleAsNodeRequest(
    port: number,
    request: Request,
  ): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
