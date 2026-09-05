/**
 * Errors that mean the process is missing required env, not that a single
 * request failed. Keep this narrow — LLM/DB "connection" failures are not
 * configuration mistakes and must not surface as the Customise Anima banner
 * "API is misconfigured on the server."
 */
export function isUnhandledConfigError(message: string): boolean {
  return (
    message.includes("DATABASE_URL") ||
    message.includes("CLERK_SECRET_KEY") ||
    message.includes("CLERK_PUBLISHABLE_KEY") ||
    /Publishable key/i.test(message)
  );
}

export const SERVER_MISCONFIGURED_MESSAGE =
  "API is misconfigured on the server. Check environment variables.";
