/**
 * Cloudflare Workers expose secrets on the `env` binding. That object is a
 * special proxy: `Object.entries(env)` often only lists wrangler `vars`
 * (here: NODE_ENV) and skips dashboard/secrets-store bindings.
 *
 * Reading `env.CLERK_SECRET_KEY` by name still works. If we only copy
 * enumerable keys, Clerk and Postgres stay unset and every /api/store call
 * returns "API is misconfigured on the server."
 *
 * Two more Worker-specific pitfalls:
 * 1. `process.env` is populated lazily on first `process` access
 *    (`nodejs_compat_populate_process_env`). `app.listen()` / Express import
 *    can snapshot only wrangler `vars` before dashboard secrets are visible.
 *    Assignments in `fetch()` may then be overwritten by `cloudflare:node`'s
 *    httpServerHandler, or not stick on the isolate's process.env object.
 * 2. Clerk proxy used to close over `CLERK_SECRET_KEY` at module load, so a
 *    binding-only deploy reused an isolate whose secretKey was permanently "".
 *
 * Prefer request-time / importable-env reads over startup closures.
 */

import type { RequestHandler } from "express";

export const DATABASE_URL_ENV_NAMES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "PRISMA_DATABASE_URL",
] as const;

/**
 * Bindings the Express app reads from process.env. Keep this list in sync with
 * `scripts/cloudflare/production-secret-names.txt` plus runtime aliases the
 * API actually uses (local LLM URL, OpenRouter key spellings, Clerk JWT).
 */
export const CLOUDFLARE_RUNTIME_ENV_NAMES = [
  "ADULT_MODE_ENABLED",
  "AI_GATEWAY_API_KEY",
  "AINMA_OPENROUTER_API_KEY",
  "ANIMA_LLM_PROVIDER",
  "ANIMA_RUNTIME",
  "ANIMA_LOCAL_LLM_API_KEY",
  "ANIMA_LOCAL_LLM_BACKEND",
  "ANIMA_LOCAL_LLM_BASE_URL",
  "ANIMA_OLLAMA_MODEL_HEAVY",
  "ANIMA_OLLAMA_MODEL_LIGHT",
  "ANIMA_OLLAMA_MODEL_STANDARD",
  "ANIMA_OPENROUTER_API_KEY",
  "ANIMA_OPENROUTER_FREE",
  "API_KEY",
  "CLERK_JWT_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CRON_SECRET",
  "DATABASE_URL",
  "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
  "DEEPSEEK_PUBLISHABLE_KEY",
  "FIRECRAWL_DEV",
  "FIREWORKS_AI_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "KIMI_API_KEY",
  "LEONARDO_AI_API",
  "NSFW_INTENSITY",
  "OLLAMA_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OPEN_ROUTER_API_KEY",
  "PERMISSIVE_API_BASE",
  "PERMISSIVE_API_KEY",
  "POSTGRES_URL",
  "PRISMA_DATABASE_URL",
  "PRIVATE_OBJECT_DIR",
  "PUBLIC_OBJECT_SEARCH_PATHS",
  "SESSION_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
  "VENICE_INFERENCE_KEY_",
  "XAI_API_KEY",
] as const;

const mirroredRuntimeEnv: Record<string, string> = {};
let importableEnv: Record<string, unknown> | undefined;
let lastRequestEnv: Record<string, unknown> | undefined;
const RUNTIME_ENV_READER = Symbol.for("anima.cloudflare.readRuntimeEnv");

export function bindImportableEnv(
  env: Record<string, unknown> | undefined,
): void {
  importableEnv = env;
  publishRuntimeEnvReader();
}

export function bindRequestEnv(env: Record<string, unknown> | undefined): void {
  lastRequestEnv = env;
  publishRuntimeEnvReader();
}

/** Test-only: drop isolate-style caches without touching the host process.env. */
export function resetCloudflareEnvBindingsForTests(): void {
  importableEnv = undefined;
  lastRequestEnv = undefined;
  for (const key of Object.keys(mirroredRuntimeEnv)) {
    delete mirroredRuntimeEnv[key];
  }
  delete (globalThis as Record<PropertyKey, unknown>)[RUNTIME_ENV_READER];
}

/**
 * Cloudflare Hyperdrive binding: `{ connectionString }` (never a secret in
 * wrangler.jsonc). Prefer this over DATABASE_URL from Workers so Postgres
 * goes through the pooler instead of Supabase direct :5432.
 *
 * `connectionString` is a lazy getter that performs isolate I/O. Reading it
 * at module load / global scope fails Worker upload with error 10021.
 * Only call this from the request path after `bindRequestEnv`.
 */
export function unwrapHyperdriveConnectionString(
  value: unknown,
): string | undefined {
  if (typeof value === "string") {
    return unwrapBindingString(value);
  }
  if (value && typeof value === "object") {
    const record = value as { connectionString?: unknown };
    return unwrapBindingString(record.connectionString);
  }
  return undefined;
}

/**
 * Worker secrets are strings. Secrets Store bindings are objects with async
 * `get()`. Some dashboard wrappers expose `{ value }`. Never log the result.
 */
export function unwrapBindingString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value && typeof value === "object") {
    const record = value as { value?: unknown };
    if (typeof record.value === "string") {
      const trimmed = record.value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

export async function unwrapBindingStringAsync(
  value: unknown,
): Promise<string | undefined> {
  const sync = unwrapBindingString(value);
  if (sync) return sync;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function"
  ) {
    try {
      const got = await (value as { get: () => unknown }).get();
      return unwrapBindingString(got);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function publishRuntimeEnvReader(): void {
  (globalThis as Record<PropertyKey, unknown>)[RUNTIME_ENV_READER] =
    readRuntimeEnv;
}

function rememberMirrored(key: string, value: string): void {
  mirroredRuntimeEnv[key] = value;
}

function writeEnvValue(
  target: Record<string, string | undefined>,
  key: string,
  value: string,
): void {
  try {
    target[key] = value;
  } catch {
    // process.env on some Worker isolates rejects assignment
  }
  if (target[key] === value) return;
  try {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } catch {
    // leave the cache / importable env as the source of truth
  }
}

function applyStringBinding(
  target: Record<string, string | undefined>,
  key: string,
  value: unknown,
  remember: boolean,
): void {
  const text = unwrapBindingString(value);
  if (!text) return;
  writeEnvValue(target, key, text);
  if (remember) rememberMirrored(key, text);
}

export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const name of DATABASE_URL_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Read a binding from the current isolate: process.env, the last mirrored
 * cache, the current request `env`, then `import { env } from "cloudflare:workers"`.
 */
export function readRuntimeEnv(name: string): string | undefined {
  const fromProcess = unwrapBindingString(process.env[name]);
  if (fromProcess) return fromProcess;
  const fromMirror = mirroredRuntimeEnv[name];
  if (fromMirror) return fromMirror;
  if (lastRequestEnv) {
    const fromRequest = unwrapBindingString(lastRequestEnv[name]);
    if (fromRequest) return fromRequest;
  }
  if (importableEnv) {
    const fromImportable = unwrapBindingString(importableEnv[name]);
    if (fromImportable) return fromImportable;
  }
  return undefined;
}

export function readHyperdriveConnectionString(): string | undefined {
  // Hyperdrive.connectionString does isolate I/O. The importable Worker env
  // and process.env may hold the same proxy at module load — never unwrap
  // those. Only the request `env` (set in applyCloudflareRequestEnv) is safe.
  if (!lastRequestEnv) return undefined;
  return unwrapHyperdriveConnectionString(lastRequestEnv.HYPERDRIVE);
}

export function readRuntimeDatabaseUrl(): string | undefined {
  const hyperdrive = readHyperdriveConnectionString();
  if (hyperdrive) return hyperdrive;
  for (const name of DATABASE_URL_ENV_NAMES) {
    const value = readRuntimeEnv(name);
    if (value) return value;
  }
  return undefined;
}

export function runtimeEnvPresence(): {
  hasDatabaseUrl: boolean;
  hasClerkSecret: boolean;
  hasClerkPublishable: boolean;
} {
  return {
    hasDatabaseUrl: Boolean(readRuntimeDatabaseUrl()),
    hasClerkSecret: Boolean(readRuntimeEnv("CLERK_SECRET_KEY")),
    hasClerkPublishable: Boolean(readRuntimeEnv("CLERK_PUBLISHABLE_KEY")),
  };
}

function aliasDatabaseUrl(target: Record<string, string | undefined>): void {
  if (target.DATABASE_URL?.trim()) return;
  const alias = resolveDatabaseUrl(target) ?? readRuntimeDatabaseUrl();
  if (!alias) return;
  writeEnvValue(target, "DATABASE_URL", alias);
  if (target === process.env) rememberMirrored("DATABASE_URL", alias);
}

function aliasHyperdriveUrl(
  target: Record<string, string | undefined>,
  env?: Record<string, unknown>,
): void {
  const hd =
    unwrapHyperdriveConnectionString(env?.HYPERDRIVE) ??
    readHyperdriveConnectionString();
  if (!hd) return;
  writeEnvValue(target, "DATABASE_URL", hd);
  if (target === process.env) rememberMirrored("DATABASE_URL", hd);
}

/**
 * Mirror Worker bindings into `process.env` so existing Express/Clerk/pg
 * reads keep working. Always assign known secret names by property access —
 * do not rely on Object.entries for secrets.
 */
export function mirrorCloudflareBindings(
  env: Record<string, unknown>,
  target: Record<string, string | undefined> = process.env,
): void {
  const remember = target === process.env;
  for (const [key, value] of Object.entries(env)) {
    applyStringBinding(target, key, value, remember);
  }
  for (const name of CLOUDFLARE_RUNTIME_ENV_NAMES) {
    applyStringBinding(target, name, env[name], remember);
  }
  aliasDatabaseUrl(target);
  // Do not unwrap Hyperdrive here. connectionString is lazy I/O and is
  // illegal at Worker module load. applyCloudflareRequestEnv does that.
}

async function copyUnwrappedBindings(
  env: Record<string, unknown>,
  target: Record<string, string | undefined>,
): Promise<void> {
  const remember = target === process.env;
  for (const name of CLOUDFLARE_RUNTIME_ENV_NAMES) {
    const text = await unwrapBindingStringAsync(env[name]);
    if (!text) continue;
    writeEnvValue(target, name, text);
    if (remember) rememberMirrored(name, text);
  }
}

async function ensureImportableEnv(): Promise<void> {
  if (importableEnv) return;
  try {
    const mod = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    if (mod?.env) bindImportableEnv(mod.env);
  } catch {
    // Node, vitest, and Vercel do not provide this built-in.
  }
}

/**
 * Request-time apply: fetch `env` + importable env, including async Secrets
 * Store `get()`. Call this from the Worker fetch handler before Express.
 */
export async function applyCloudflareRequestEnv(
  env: Record<string, unknown>,
  target: Record<string, string | undefined> = process.env,
): Promise<void> {
  bindRequestEnv(env);
  publishRuntimeEnvReader();
  await ensureImportableEnv();
  mirrorCloudflareBindings(env, target);
  if (importableEnv && importableEnv !== env) {
    mirrorCloudflareBindings(importableEnv, target);
  }
  await copyUnwrappedBindings(env, target);
  if (importableEnv && importableEnv !== env) {
    await copyUnwrappedBindings(importableEnv, target);
  }
  aliasDatabaseUrl(target);
  // Request path only — Worker fetch has started, so Hyperdrive I/O is legal.
  aliasHyperdriveUrl(target, env);
}

/**
 * Re-apply cached / importable / last-request strings onto process.env.
 * `cloudflare:node` httpServerHandler may snapshot or reset process.env
 * after `fetch()` mirroring; Express must remirror inside the request.
 */
export function remirrorRuntimeEnvIntoProcess(
  target: Record<string, string | undefined> = process.env,
): void {
  publishRuntimeEnvReader();
  const remember = target === process.env;
  for (const [key, value] of Object.entries(mirroredRuntimeEnv)) {
    if (value) writeEnvValue(target, key, value);
  }
  if (importableEnv) {
    for (const name of CLOUDFLARE_RUNTIME_ENV_NAMES) {
      applyStringBinding(target, name, importableEnv[name], remember);
    }
  }
  if (lastRequestEnv) {
    for (const name of CLOUDFLARE_RUNTIME_ENV_NAMES) {
      applyStringBinding(target, name, lastRequestEnv[name], remember);
    }
  }
  aliasDatabaseUrl(target);
}

export function syncCloudflareRuntimeEnvMiddleware(): RequestHandler {
  return (_req, _res, next) => {
    remirrorRuntimeEnvIntoProcess();
    next();
  };
}
