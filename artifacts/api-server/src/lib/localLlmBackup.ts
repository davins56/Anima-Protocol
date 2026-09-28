/**
 * Optional second self-hosted Ollama / vLLM address.
 *
 * `ANIMA_LOCAL_LLM_BACKUP_BASE_URL` points at the same anima-chat model on
 * another host (planned: https://llm-backup.anima-protocol.com/v1). It is
 * never hardcoded. When the variable is unset, callers must keep today's
 * single-host fail-closed behavior — no OpenRouter and no OpenAI hop.
 */

const CLOUD_FLAGSHIP_HOSTS = new Set([
  "api.openai.com",
  "openai.com",
  "api.groq.com",
  "groq.com",
  "generativelanguage.googleapis.com",
  "api.anthropic.com",
  "api.x.ai",
  "api.moonshot.ai",
  "api.moonshot.cn",
  "api.minimax.io",
  "minimax.io",
  "openrouter.ai",
  "api.openrouter.ai",
]);

function isCloudFlagshipHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (CLOUD_FLAGSHIP_HOSTS.has(h)) return true;
  for (const blocked of CLOUD_FLAGSHIP_HOSTS) {
    if (h.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

function loopbackUnreachable(env: NodeJS.ProcessEnv): boolean {
  const runtime = (env.ANIMA_RUNTIME || "").trim().toLowerCase();
  if (runtime === "node" || runtime === "local" || runtime === "dev" || runtime === "development") {
    return false;
  }
  if (
    runtime === "worker" ||
    runtime === "cloudrun" ||
    runtime === "cloud-run" ||
    runtime === "gcp"
  ) {
    return true;
  }
  return Boolean(env.VERCEL || env.VERCEL_ENV || env.CF_PAGES || env.K_SERVICE || env.CLOUD_RUN_JOB);
}

/**
 * Normalized OpenAI-compatible backup URL, or null when unset / unusable.
 * A bare origin (`https://llm-backup.anima-protocol.com`) gains `/v1`.
 * Cloud chat APIs and loopback-on-Workers are ignored so they cannot become
 * a silent hop.
 */
export function localLlmBackupBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.ANIMA_LOCAL_LLM_BACKUP_BASE_URL?.trim();
  if (!raw) return null;
  let base = raw.replace(/\/+$/, "");
  if (!/\/v1$/i.test(base)) base = `${base}/v1`;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isCloudFlagshipHost(url.hostname)) return null;
  if (loopbackUnreachable(env) && isLoopbackHost(url.hostname)) return null;
  return base;
}

/**
 * Backup host to try after the primary, or null when unset, identical to
 * the primary, or unusable. No backup means the caller must not change
 * provider.
 */
export function usableLocalLlmBackupBaseUrl(
  env: NodeJS.ProcessEnv,
  primaryBaseUrl: string | null | undefined,
): string | null {
  const backup = localLlmBackupBaseUrl(env);
  const primary = primaryBaseUrl?.trim().replace(/\/+$/, "") || "";
  if (!backup || !primary) return null;
  if (backup === primary) return null;
  return backup;
}
