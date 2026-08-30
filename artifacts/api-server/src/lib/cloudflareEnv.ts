/**
 * Cloudflare Workers expose secrets on the `env` binding. That object is a
 * special proxy: `Object.entries(env)` often only lists wrangler `vars`
 * (here: NODE_ENV) and skips dashboard/secrets-store bindings.
 *
 * Reading `env.CLERK_SECRET_KEY` by name still works. If we only copy
 * enumerable keys, Clerk and Postgres stay unset and every /api/store call
 * returns "API is misconfigured on the server."
 */

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

export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const name of DATABASE_URL_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function applyStringBinding(
  target: Record<string, string | undefined>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "string" && value) {
    target[key] = value;
  }
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
  for (const [key, value] of Object.entries(env)) {
    applyStringBinding(target, key, value);
  }
  for (const name of CLOUDFLARE_RUNTIME_ENV_NAMES) {
    applyStringBinding(target, name, env[name]);
  }
  if (!target.DATABASE_URL?.trim()) {
    const alias = resolveDatabaseUrl(target);
    if (alias) target.DATABASE_URL = alias;
  }
}
