/**
 * Helper to render text with italic styling for *text* patterns
 */
export const renderItalicText = (text) => {
  if (!text) return text;
  return text.split(/(\*[^*]+\*)/g).map((part, idx) => {
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={idx} className="text-primary/70 opacity-75">{part.slice(1, -1)}</em>;
    }
    return <span key={idx}>{part}</span>;
  });
};