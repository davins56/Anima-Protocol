import { classifyDbError, errorCauseBlob, isWorkerApiTimeoutError } from "./dbErrors";
import { LlmStreamTimeoutError } from "./consumeLlmStream.js";
import {
  isLocalOnlyProviderChain,
  isOpenRouterGenericProviderError,
  isOpenRouterZdrOrDataPolicyError,
  isWorkerSubrequestLimitError,
  LOCAL_LLM_SUBREQUEST_HINT,
  localOnlyTimeoutMessage,
  OPENROUTER_FREE_PROVIDER_HINT,
  OPENROUTER_ZDR_PRIVACY_HINT,
  remapGenericProviderError,
} from "./llmFailover";
import {
  WORKERS_AI_FREE_QUOTA_HINT,
  isWorkersAiFreeQuotaError,
} from "./workersAi";

const COMPANION_MEMORIES_RE = /companion_memories/i;
const FAILED_QUERY_RE = /Failed query/i;
const SQL_LEAK_RE =
  /Failed query\b|select\s+"id"\s*,\s*"user_id"|params:\s*user_|from\s+"[^"]+"/i;

const COMPANION_MEMORY_TIMEOUT =
  "Couldn't load companion memory — the database timed out. Please try again.";
const COMPANION_MEMORY_SCHEMA =
  "Couldn't load companion memory — the database schema is missing or out of date.";
const COMPANION_MEMORY_GENERIC =
  "Couldn't load companion memory. Please try again.";
const GENERIC_COMPANION_FAILURE =
  "The companion could not reply. Please try again.";

function looksLikeSqlLeak(message: string): boolean {
  return FAILED_QUERY_RE.test(message) || SQL_LEAK_RE.test(message);
}

function companionMemoryOrDbMessage(err: unknown): string {
  const dbInfo = classifyDbError(err);
  const blob = errorCauseBlob(err);
  if (COMPANION_MEMORIES_RE.test(blob)) {
    if (dbInfo.reason === "timeout") return COMPANION_MEMORY_TIMEOUT;
    if (dbInfo.reason === "schema") return COMPANION_MEMORY_SCHEMA;
    return COMPANION_MEMORY_GENERIC;
  }
  if (dbInfo.isDbError) return dbInfo.safeMessage;
  return GENERIC_COMPANION_FAILURE;
}

/**
 * Map a failed `/chat/messages` stream into HUD-safe copy.
 * Drizzle "Failed query" wrappers (SQL + bind params) must never reach the
 * client toast — keep the raw error in server logs.
 */
export function streamErrorMessage(err: unknown): string {
  if (err instanceof LlmStreamTimeoutError) {
    return typeof isLocalOnlyProviderChain === "function" &&
      isLocalOnlyProviderChain()
      ? localOnlyTimeoutMessage()
      : err.message;
  }
  if (isWorkersAiFreeQuotaError(err)) {
    return WORKERS_AI_FREE_QUOTA_HINT;
  }
  if (isWorkerSubrequestLimitError(err)) {
    return LOCAL_LLM_SUBREQUEST_HINT;
  }
  if (isOpenRouterZdrOrDataPolicyError(err)) {
    return OPENROUTER_ZDR_PRIVACY_HINT;
  }
  if (isOpenRouterGenericProviderError(err)) {
    const remapped =
      err instanceof Error
        ? remapGenericProviderError(err)
        : new Error(OPENROUTER_FREE_PROVIDER_HINT);
    return remapped.message;
  }
  // Worker 20s wall — not a Postgres failure. Do not call it a database
  // timeout (#450) and do not leak a drizzle wrapper that mentions it.
  if (isWorkerApiTimeoutError(err)) {
    return typeof isLocalOnlyProviderChain === "function" &&
      isLocalOnlyProviderChain()
      ? localOnlyTimeoutMessage()
      : "The companion took too long to reply. Please try again.";
  }

  const dbInfo = classifyDbError(err);
  if (dbInfo.isDbError) {
    return companionMemoryOrDbMessage(err);
  }

  const raw = err instanceof Error ? err.message : String(err);
  if (looksLikeSqlLeak(raw)) {
    return companionMemoryOrDbMessage(err);
  }
  if (/aborted|abort/i.test(raw)) {
    return typeof localOnlyTimeoutMessage === "function"
      ? localOnlyTimeoutMessage()
      : "The companion took too long to reply. Please try again.";
  }
  if (/workers ai|deepseek/i.test(raw)) {
    return raw;
  }
  return raw;
}
