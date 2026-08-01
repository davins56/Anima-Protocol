/**
 * Classify and sanitize database / driver errors so API responses never leak
 * connection strings or credentials, while still giving operators a usable signal.
 */

export type DbErrorInfo = {
  isDbError: boolean;
  code?: string;
  safeMessage: string;
};

const SENSITIVE =
  /postgresql:\/\/[^\s"'\\]+|postgres:\/\/[^\s"'\\]+|password=[^\s&"']+|PWD=[^\s&"']+/gi;

function scrub(message: string): string {
  return message.replace(SENSITIVE, "[redacted]").slice(0, 300);
}

export function classifyDbError(err: unknown): DbErrorInfo {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";

  const looksLikeDb =
    code.startsWith("28") || // invalid auth
    code.startsWith("3D") || // invalid catalog
    code.startsWith("42") || // syntax / missing relation
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ERR_SSL_WRONG_VERSION_NUMBER" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    /Failed query/i.test(message) ||
    /DATABASE_URL/i.test(message) ||
    /connect\s+ECONNREFUSED/i.test(message) ||
    /getaddrinfo/i.test(message) ||
    /timeout expired/i.test(message) ||
    /Connection terminated/i.test(message) ||
    /sorry, too many clients/i.test(message) ||
    /password authentication failed/i.test(message) ||
    /no pg_hba\.conf/i.test(message) ||
    /SSL/i.test(message) ||
    /certificate/i.test(message) ||
    /does not exist/i.test(message);

  if (!looksLikeDb) {
    return { isDbError: false, safeMessage: "Internal server error" };
  }

  let safeMessage = "Database unavailable";
  if (/password authentication failed/i.test(message)) {
    safeMessage = "Database authentication failed";
  } else if (/does not exist/i.test(message) || code.startsWith("42")) {
    safeMessage = "Database schema is missing or out of date";
  } else if (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|timeout expired/i.test(
      `${code} ${message}`,
    )
  ) {
    safeMessage = "Database host unreachable";
  } else if (/SSL|certificate|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(message)) {
    safeMessage = "Database SSL connection failed";
  } else if (/too many clients/i.test(message)) {
    safeMessage = "Database connection limit reached";
  }

  return {
    isDbError: true,
    code: code || undefined,
    safeMessage: scrub(safeMessage),
  };
}

/** Non-secret connection metadata for readiness probes. */
export function databaseTargetHint(
  rawUrl: string | undefined = process.env.DATABASE_URL,
): {
  configured: boolean;
  protocol?: string;
  host?: string;
  port?: string;
  database?: string;
  sslmode?: string | null;
} {
  if (!rawUrl?.trim()) return { configured: false };
  try {
    const parsed = new URL(rawUrl.replace(/^postgres(ql)?:/i, "http:"));
    return {
      configured: true,
      protocol: /^postgres:\/\//i.test(rawUrl) ? "postgres" : "postgresql",
      host: parsed.hostname || undefined,
      port: parsed.port || undefined,
      database: parsed.pathname.replace(/^\//, "") || undefined,
      sslmode: parsed.searchParams.get("sslmode"),
    };
  } catch {
    return { configured: true };
  }
}
