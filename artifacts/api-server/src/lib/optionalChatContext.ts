import { logger } from "./logger";

/**
 * Best-effort enrichment only (memories, weather, and derived state).
 * Character identity and conversation history must not use this fallback:
 * lean client prompts do not contain a backup of those required inputs.
 */
export async function optionalChatContext<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    logger.warn(
      { err, label },
      "Optional chat context unavailable; continuing the reply without it",
    );
    return fallback;
  }
}
