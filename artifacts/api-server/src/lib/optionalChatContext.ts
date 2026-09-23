import { logger } from "./logger";

/**
 * Best-effort chat context. Hyperdrive / Worker socket blips must not abort
 * the LLM after the typing indicator is already on screen — the client already
 * sent conversation history in `system_prompt`.
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
