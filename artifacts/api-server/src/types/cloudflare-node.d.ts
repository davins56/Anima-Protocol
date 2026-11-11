interface DurableObjectState {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
  };
}

declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;

  export abstract class DurableObject<Env = unknown> {
    ctx: DurableObjectState;
    env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
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
