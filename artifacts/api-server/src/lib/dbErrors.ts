import {
  readHyperdriveConnectionString,
  readRuntimeDatabaseUrl,
} from "./cloudflareEnv";

/**
 * Classify and sanitize database / driver errors so API responses never leak
 * connection strings or credentials, while still giving operators a usable signal.
 */

export type DbErrorReason =
  | "timeout"
  | "ssl"
  | "refused"
  | "reset"
  | "unreachable"
  | "auth"
  | "schema"
  | "limit"
  | "unavailable"
  | "internal";

export type DbErrorInfo = {
  isDbError: boolean;
  code?: string;
  reason: DbErrorReason;
  safeMessage: string;
};

const SENSITIVE =
  /postgresql:\/\/[^\s"'\\]+|postgres:\/\/[^\s"'\\]+|password=[^\s&"']+|PWD=[^\s&"']+/gi;

function scrub(message: string): string {
  return message.replace(SENSITIVE, "[redacted]").slice(0, 300);
}

/** Walk Error.cause / nested driver errors so drizzle wrappers still expose ENOTFOUND etc. */
function collectErrorSignals(err: unknown): { message: string; code: string } {
  const messages: string[] = [];
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
    } else if (typeof current === "string") {
      messages.push(current);
    }
    if (current && typeof current === "object" && "code" in current) {
      const c = String((current as { code?: unknown }).code ?? "");
      if (c) codes.push(c);
    }
    current =
      current && typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return { message: messages.join("\n"), code: codes[0] || "" };
}

export function classifyDbError(err: unknown): DbErrorInfo {
  const { message, code } = collectErrorSignals(err);

  const looksLikeDb =
    code.startsWith("28") || // invalid auth
    code.startsWith("3D") || // invalid catalog
    code.startsWith("42") || // syntax / missing relation
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ETIMEOUT" ||
    code === "ECONNRESET" ||
    code === "ABORT_ERR" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ERR_SSL_WRONG_VERSION_NUMBER" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    /Failed query/i.test(message) ||
    /DATABASE_URL/i.test(message) ||
    /connect\s+ECONNREFUSED/i.test(message) ||
    /connection refused/i.test(message) ||
    /getaddrinfo/i.test(message) ||
    /timeout expired/i.test(message) ||
    /connection timeout/i.test(message) ||
    /ConnectTimeout/i.test(message) ||
    /SocketTimeout/i.test(message) ||
    /aborted due to timeout/i.test(message) ||
    /Connection terminated/i.test(message) ||
    /Connection ended unexpectedly/i.test(message) ||
    /Network connection lost/i.test(message) ||
    /sorry, too many clients/i.test(message) ||
    /password authentication failed/i.test(message) ||
    /no pg_hba\.conf/i.test(message) ||
    /SSL/i.test(message) ||
    /certificate/i.test(message) ||
    /does not exist/i.test(message);

  if (!looksLikeDb) {
    return {
      isDbError: false,
      reason: "internal",
      safeMessage: "Internal server error",
    };
  }

  const blob = `${code} ${message}`;
  let reason: DbErrorReason = "unavailable";
  let safeMessage = "Database unavailable";

  if (/password authentication failed/i.test(message)) {
    reason = "auth";
    safeMessage = "Database authentication failed";
  } else if (/does not exist/i.test(message) || code.startsWith("42")) {
    reason = "schema";
    safeMessage = "Database schema is missing or out of date";
  } else if (/too many clients/i.test(message)) {
    reason = "limit";
    safeMessage = "Database connection limit reached";
  } else if (
    /ERR_SSL|SSL|certificate|UNABLE_TO_VERIFY|SELF_SIGNED|wrong version number/i.test(
      blob,
    )
  ) {
    reason = "ssl";
    safeMessage = "Database SSL connection failed";
  } else if (/ECONNREFUSED|connection refused/i.test(blob)) {
    reason = "refused";
    safeMessage = "Database connection refused";
  } else if (
    /ETIMEDOUT|ETIMEOUT|UND_ERR_CONNECT_TIMEOUT|timeout expired|connection timeout|ConnectTimeout|SocketTimeout|aborted due to timeout/i.test(
      blob,
    )
  ) {
    reason = "timeout";
    safeMessage = "Database connection timed out";
  } else if (
    /ECONNRESET|UND_ERR_SOCKET|Connection terminated|Connection ended unexpectedly|Network connection lost/i.test(
      blob,
    )
  ) {
    reason = "reset";
    safeMessage = "Database connection reset";
  } else if (/ENOTFOUND|getaddrinfo/i.test(blob)) {
    reason = "unreachable";
    safeMessage = "Database host unreachable";
  }

  return {
    isDbError: true,
    code: code || reason,
    reason,
    safeMessage: scrub(safeMessage),
  };
}

/** Non-secret connection metadata for readiness probes. */
export function databaseConnectionSource(
  rawUrl: string | undefined = readRuntimeDatabaseUrl(),
): "hyperdrive" | "database_url" | "none" {
  if (readHyperdriveConnectionString()) return "hyperdrive";
  if (rawUrl?.trim()) return "database_url";
  return "none";
}

export function databaseTargetHint(
  rawUrl: string | undefined = readRuntimeDatabaseUrl(),
): {
  configured: boolean;
  source: "hyperdrive" | "database_url" | "none";
  protocol?: string;
  host?: string;
  port?: string;
  database?: string;
  sslmode?: string | null;
} {
  const source = databaseConnectionSource(rawUrl);
  if (!rawUrl?.trim()) return { configured: false, source };

  const sslmodeMatch = rawUrl.match(/[?&]sslmode=([^&]*)/i);
  const sslmode = sslmodeMatch
    ? decodeURIComponent(sslmodeMatch[1])
    : null;

  try {
    const parsed = new URL(rawUrl.replace(/^postgres(ql)?:/i, "http:"));
    return {
      configured: true,
      source,
      protocol: /^postgres:\/\//i.test(rawUrl) ? "postgres" : "postgresql",
      host: parsed.hostname || undefined,
      port: parsed.port || undefined,
      database: parsed.pathname.replace(/^\//, "") || undefined,
      // Presence only. sslmode=require on Supabase :5432 can still fail from
      // Cloudflare Workers — do not infer that sslmode is missing.
      sslmode: parsed.searchParams.get("sslmode") ?? sslmode,
    };
  } catch {
    // Passwords with unencoded @/# break URL(); fall back to a credential-free regex.
    const hostMatch = rawUrl.match(
      /^postgres(?:ql)?:\/\/(?:[^/@]+@)?(\[[^\]]+\]|[^/:?]+)(?::(\d+))?/i,
    );
    const dbMatch = rawUrl.match(
      /^postgres(?:ql)?:\/\/[^/]+\/([^?]+)/i,
    );
    return {
      configured: true,
      source,
      protocol: /^postgres:\/\//i.test(rawUrl) ? "postgres" : "postgresql",
      host: hostMatch?.[1]?.replace(/^\[|\]$/g, "") || undefined,
      port: hostMatch?.[2] || undefined,
      database: dbMatch?.[1] ? decodeURIComponent(dbMatch[1]) : undefined,
      sslmode,
    };
  }
}
