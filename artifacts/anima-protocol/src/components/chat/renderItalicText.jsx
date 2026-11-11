// @ts-check
import { ROLEPLAY_ACTION_CLASS } from "./messageMarkdownUtils";

/**
 * Helper to render text with italic styling for **text** and *text* patterns.
 * Used by lore highlighters that split a message into keyword segments.
 * Chat bubbles themselves go through MessageMarkdown, which keeps the same
 * *action* styling via ROLEPLAY_ACTION_CLASS.
 * @param {string} text
 */
export const renderItalicText = (text) => {
  if (!text) return text;
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((/** @type {string} */ part, /** @type {number} */ idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <em key={idx} className={ROLEPLAY_ACTION_CLASS}>{part.slice(2, -2)}</em>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={idx} className={ROLEPLAY_ACTION_CLASS}>{part.slice(1, -1)}</em>;
    }
    return <span key={idx}>{part}</span>;
  });
};

export { ROLEPLAY_ACTION_CLASS };
