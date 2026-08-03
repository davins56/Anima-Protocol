// @ts-check
/**
 * Helper to render text with italic styling for **text** and *text* patterns
 * @param {string} text
 */
export const renderItalicText = (text) => {
  if (!text) return text;
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((/** @type {string} */ part, /** @type {number} */ idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <em key={idx} className="text-primary/70 opacity-75">{part.slice(2, -2)}</em>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={idx} className="text-primary/70 opacity-75">{part.slice(1, -1)}</em>;
    }
    return <span key={idx}>{part}</span>;
  });
};
