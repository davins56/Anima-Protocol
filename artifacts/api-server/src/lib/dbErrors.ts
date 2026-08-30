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
  /** Secret-free name/code/message snippet for /healthz/db operators. */
  signal?: string;
};

/** postgres.js connection errors use these codes (not Node's ETIMEDOUT). */
export const POSTGRES_JS_CONNECTION_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECT_ERROR",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
  "CONNECTION_TIMEOUT",
]);

const SENSITIVE =
  /postgresql:\/\/[^\s"'\\]+|postgres:\/\/[^\s"'\\]+|password=[^\s&"']+|PWD=[^\s&"']+/gi;

function scrub(message: string): string {
  return message.replace(SENSITIVE, "[redacted]").slice(0, 300);
}

/** Walk Error.cause / nested driver errors so drizzle wrappers still expose ENOTFOUND etc. */
function collectErrorSignals(err: unknown): {
  message: string;
  code: string;
  name: string;
} {
  const messages: string[] = [];
  const codes: string[] = [];
  const names: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
      if (current.name && current.name !== "Error") names.push(current.name);
    } else if (typeof current === "string") {
      messages.push(current);
    } else if (current && typeof current === "object" && "message" in current) {
      const nested = (current as { message?: unknown }).message;
      if (typeof nested === "string" && nested) messages.push(nested);
    }
    if (current && typeof current === "object") {
      const obj = current as {
        code?: unknown;
        errno?: unknown;
        name?: unknown;
        severity?: unknown;
      };
      const c = String(obj.code ?? obj.errno ?? "");
      if (c) codes.push(c);
      if (typeof obj.name === "string" && obj.name && obj.name !== "Error") {
        names.push(obj.name);
      }
      if (typeof obj.severity === "string" && obj.severity) {
        names.push(obj.severity);
      }
    }
    current =
      current && typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return {
    message: messages.join("\n"),
    code: codes[0] || "",
    name: names[0] || "",
  };
}

/** Operator-facing snippet: name + code + scrubbed message. Never a URL. */
export function secretFreeErrorSignal(err: unknown): {
  code?: string;
  name?: string;
  signal: string;
} {
  const { message, code, name } = collectErrorSignals(err);
  const scrubbed = scrub(message)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const signal = [name, code, scrubbed].filter(Boolean).join(" ").slice(0, 120);
  return {
    code: code || undefined,
    name: name || undefined,
    signal: signal || "unclassified",
  };
}

export function classifyDbError(err: unknown): DbErrorInfo {
  const { message, code, name } = collectErrorSignals(err);
  const signal = secretFreeErrorSignal(err).signal;
  const blob = `${name} ${code} ${message}`;

  const looksLikeDb =
    code.startsWith("28") || // invalid auth
    code.startsWith("3D") || // invalid catalog
    code.startsWith("42") || // syntax / missing relation
    code.startsWith("22") || // data exception (e.g. 22P02 malformed array)
    code.startsWith("08") || // connection exception
    /^[0-9A-Z]{5}$/.test(code) || // any other Postgres SQLSTATE
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ETIMEOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN" ||
    code === "ABORT_ERR" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ERR_SSL_WRONG_VERSION_NUMBER" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    POSTGRES_JS_CONNECTION_CODES.has(code) ||
    name === "PostgresError" ||
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
    /write CONNECT_/i.test(message) ||
    /CONNECT_TIMEOUT|CONNECT_ERROR|CONNECTION_(?:ENDED|DESTROYED|CLOSED|TIMEOUT)/i.test(
      blob,
    ) ||
    /hyperdrive/i.test(blob) ||
    /prisma\.io|prisma accelerate/i.test(blob) ||
    /could not connect to (?:origin )?database/i.test(message) ||
    /origin database/i.test(message) ||
    /invalid startup packet/i.test(message) ||
    /unsupported (?:startup )?protocol/i.test(message) ||
    /not a postgres(?:ql)? (?:server|wire)/i.test(message) ||
    /Connection terminated/i.test(message) ||
    /Connection ended unexpectedly/i.test(message) ||
    /Network connection lost/i.test(message) ||
    /socket hang up/i.test(message) ||
    /broken pipe/i.test(message) ||
    /sorry, too many clients/i.test(message) ||
    /password authentication failed/i.test(message) ||
    /no pg_hba\.conf/i.test(message) ||
    /SSL/i.test(message) ||
    /certificate/i.test(message) ||
    /does not exist/i.test(message) ||
    /malformed array literal/i.test(message) ||
    /invalid input syntax/i.test(message) ||
    /could not determine data type/i.test(message);

  if (!looksLikeDb) {
    return {
      isDbError: false,
      reason: "internal",
      safeMessage: "Internal server error",
      code: code || "internal",
      signal,
    };
  }

  let reason: DbErrorReason = "unavailable";
  let safeMessage = "Database unavailable";

  if (/password authentication failed/i.test(message)) {
    reason = "auth";
    safeMessage = "Database authentication failed";
  } else if (/does not exist/i.test(message) || code.startsWith("42")) {
    reason = "schema";
    safeMessage = "Database schema is missing or out of date";
  } else if (
    code.startsWith("22") ||
    /malformed array literal|invalid input syntax|could not determine data type/i.test(
      message,
    )
  ) {
    reason = "unavailable";
    safeMessage = "Database query failed";
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
  } else if (/ECONNREFUSED|connection refused|CONNECT_ERROR/i.test(blob)) {
    reason = "refused";
    safeMessage = "Database connection refused";
  } else if (
    /ETIMEDOUT|ETIMEOUT|UND_ERR_CONNECT_TIMEOUT|CONNECT_TIMEOUT|CONNECTION_TIMEOUT|timeout expired|connection timeout|ConnectTimeout|SocketTimeout|aborted due to timeout/i.test(
      blob,
    )
  ) {
    reason = "timeout";
    safeMessage = "Database connection timed out";
  } else if (
    /ECONNRESET|UND_ERR_SOCKET|CONNECTION_ENDED|CONNECTION_DESTROYED|CONNECTION_CLOSED|Connection terminated|Connection ended unexpectedly|Network connection lost/i.test(
      blob,
    )
  ) {
    reason = "reset";
    safeMessage = "Database connection reset";
  } else if (/ENOTFOUND|getaddrinfo|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN/i.test(blob)) {
    reason = "unreachable";
    safeMessage = "Database host unreachable";
  } else if (
    /hyperdrive|prisma\.io|prisma accelerate|origin database|invalid startup packet|unsupported (?:startup )?protocol|not a postgres/i.test(
      blob,
    )
  ) {
    reason = "unavailable";
    safeMessage = "Database unavailable";
  }

  return {
    isDbError: true,
    code: code || reason,
    reason,
    safeMessage: scrub(safeMessage),
    signal,
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
