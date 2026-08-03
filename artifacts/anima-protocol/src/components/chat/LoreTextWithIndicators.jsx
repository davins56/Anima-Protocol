// @ts-check
import { useMemo } from 'react';
import LoreKeywordBadge from '@/components/lore/LoreKeywordBadge';
import { renderItalicText } from './renderItalicText';

/**
 * Renders message content with inline lore keyword indicators.
 * Detects and highlights lore concepts mentioned in the text.
 */
/**
 * @param {{ content?: string, loreContext?: any[] }} props
 */
export default function LoreTextWithIndicators({ content = '', loreContext = [] }) {
  const segments = useMemo(() => {
    if (!loreContext || loreContext.length === 0) {
      return [{ text: content, lore: null }];
    }

    // Create segments by splitting on detected keywords
    let text = content;
    const segments = [];

    // Sort lore entries by position (keyword position in text)
    const sortedLore = [...loreContext].sort((a, b) => {
      const posA = content.toLowerCase().indexOf(a.keyword.toLowerCase());
      const posB = content.toLowerCase().indexOf(b.keyword.toLowerCase());
      return posA - posB;
    });

    let lastIndex = 0;

    for (const lore of sortedLore) {
      const keyword = lore.keyword;
      const keywordLower = keyword.toLowerCase();
      const index = text.toLowerCase().indexOf(keywordLower, lastIndex);

      if (index !== -1) {
        // Add text before keyword
        if (index > lastIndex) {
          segments.push({
            text: text.substring(lastIndex, index),
            lore: null,
          });
        }

        // Add keyword with lore context
        segments.push({
          text: text.substring(index, index + keyword.length),
          lore,
        });

        lastIndex = index + keyword.length;
      }
    }

    // Add remaining text
    if (lastIndex < text.length) {
      segments.push({
        text: text.substring(lastIndex),
        lore: null,
      });
    }

    return segments.length > 0 ? segments : [{ text: content, lore: null }];
  }, [content, loreContext]);

  return (
    <span>
      {segments.map((segment, idx) =>
        segment.lore ? (
          <LoreKeywordBadge key={idx} loreEntry={segment.lore} />
        ) : (
          <span key={idx}>{renderItalicText(segment.text)}</span>
        )
      )}
    </span>
  );
}