/**
 * Classify Customise Anima companion-store failures so the hub never shows
 * the same "API is misconfigured" card for every error.
 *
 * Kinds:
 * - misconfigured — missing Clerk / DATABASE_URL env on the server (503)
 * - unsigned — no session / 401 / expired token
 * - database — env is present but Postgres is unreachable
 * - timeout — client AbortSignal.timeout / storeFetch code "timeout"
 * - empty — signed in, store ok, no personal Anima yet
 * - unknown — any other store failure
 *
 * A client abort is not a database verdict (PR #340). Classify it as
 * `timeout` so the hub never shows UNKNOWN or "database unreachable".
 */

export const CUSTOMISE_ANIMA_LOAD_KINDS = [
  "misconfigured",
  "unsigned",
  "database",
  "timeout",
  "empty",
  "unknown",
];

const SERVER_MISCONFIGURED =
  "API is misconfigured on the server. Check environment variables.";

function errorText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return String(err.message || "");
}

function errorStatus(err) {
  const status = Number(err?.status);
  return Number.isFinite(status) ? status : 0;
}

export function classifyCustomiseAnimaLoadError(err) {
  const status = errorStatus(err);
  const message = errorText(err);
  const blob = `${status} ${message}`;

  if (
    status === 401 ||
    status === 403 ||
    /not signed in|session not recognized|session may have expired|unauthorized|store auth token not available/i.test(
      message,
    )
  ) {
    return "unsigned";
  }

  if (
    message === SERVER_MISCONFIGURED ||
    /API is misconfigured/i.test(message) ||
    /check environment variables/i.test(message) ||
    /CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY|Publishable key/i.test(message)
  ) {
    return "misconfigured";
  }

  if (
    /DATABASE_URL must be set|Missing required environment variable: DATABASE_URL/i.test(
      message,
    )
  ) {
    return "misconfigured";
  }

  if (
    /database (unavailable|host unreachable|connection|authentication|schema|ssl)|postgres/i.test(
      message,
    ) ||
    /Database connection (refused|timed out|reset)|Database host unreachable/i.test(
      blob,
    )
  ) {
    return "database";
  }

  // storeFetch rewrites AbortSignal.timeout to { code: "timeout" }. Do not
  // treat that as a server Hyperdrive/Postgres verdict — those carry dbError
  // / "Database connection timed out" and already matched above.
  if (
    err?.code === "timeout" ||
    err?.name === "TimeoutError" ||
    err?.name === "AbortError" ||
    /took too long to respond/i.test(message)
  ) {
    return "timeout";
  }

  return "unknown";
}

export function customiseAnimaLoadCopy(kind, rawMessage = "") {
  switch (kind) {
    case "misconfigured":
      return {
        kind,
        headline: SERVER_MISCONFIGURED,
        body: "Required Clerk or database bindings are missing on the Worker. This is a server configuration problem — not an empty companion list. Retry after the bindings are restored.",
        showRetry: true,
        showForge: false,
        showSignIn: false,
      };
    case "unsigned":
      return {
        kind,
        headline: "Sign in to customise your Anima.",
        body: "Your session is missing or expired. Sign in again, then retry. This is not a server misconfiguration.",
        showRetry: true,
        showForge: false,
        showSignIn: true,
      };
    case "database":
      return {
        kind,
        headline: "The companion store cannot reach the database.",
        body: rawMessage
          ? `${rawMessage}. The API has credentials, but Postgres is unreachable from this host. Retry in a moment.`
          : "The API has credentials, but Postgres is unreachable from this host. Retry in a moment.",
        showRetry: true,
        showForge: false,
        showSignIn: false,
      };
    case "timeout":
      return {
        kind,
        headline: "The companion store took too long to respond.",
        body: rawMessage
          ? `${rawMessage} This is a brief stall after sign-in — not a missing database or an expired session.`
          : "The signed-in companion list did not finish in time. Retry in a moment.",
        showRetry: true,
        showForge: false,
        showSignIn: false,
      };
    case "empty":
      return {
        kind,
        headline: "No personal Anima found yet.",
        body: "Forge your companion first, then return here to shape their look, personality, soulprint, expression, voice, and permissions.",
        showRetry: true,
        showForge: true,
        showSignIn: false,
      };
    default:
      return {
        kind: "unknown",
        headline: "The companion store could not load.",
        body:
          rawMessage ||
          "Something unexpected went wrong. Retry, or sign in again if your session expired.",
        showRetry: true,
        showForge: true,
        showSignIn: true,
      };
  }
}
