import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { renderItalicText } from '@/components/chat/renderItalicText';

export default function LoreKeywordHighlighter({ 
  content, 
  loreLinks = [],
  onKeywordHover,
  compact = false 
}) {
  const [hoveredKeyword, setHoveredKeyword] = useState(null);
  const [selectedKeyword, setSelectedKeyword] = useState(null);

  if (!content || !loreLinks || loreLinks.length === 0) {
    return <span>{content}</span>;
  }

  // Sort links by position (reverse so we can build from end)
  const sortedLinks = [...loreLinks].sort((a, b) => b.position - a.position);

  // Build content with highlighted keywords
  let processedContent = content;
  const keywordElements = [];
  const positionMap = new Map();

  sortedLinks.forEach((link, idx) => {
    const keyword = link.keyword;
    const startPos = link.position;
    const endPos = startPos + keyword.length;
    
    // Avoid duplicate highlighting at same position
    const posKey = `${startPos}-${endPos}`;
    if (positionMap.has(posKey)) return;
    positionMap.set(posKey, true);

    const before = processedContent.substring(0, startPos);
    const highlighted = processedContent.substring(startPos, endPos);
    const after = processedContent.substring(endPos);

    keywordElements.unshift({
      key: `${startPos}-${idx}`,
      before,
      highlighted,
      after,
      link,
    });

    processedContent = `${before}[KEYWORD_${idx}]${after}`;
  });

  // Rebuild with highlighted elements
  if (keywordElements.length === 0) {
    return <span>{content}</span>;
  }

  let result = content;
  const parts = [];
  let lastEnd = 0;

  sortedLinks.forEach((link, idx) => {
    const startPos = link.position;
    const endPos = startPos + link.keyword.length;

    if (startPos > lastEnd) {
      parts.push({
        type: 'text',
        content: content.substring(lastEnd, startPos),
      });
    }

    parts.push({
      type: 'keyword',
      content: content.substring(startPos, endPos),
      link,
    });

    lastEnd = endPos;
  });

  if (lastEnd < content.length) {
    parts.push({
      type: 'text',
      content: content.substring(lastEnd),
    });
  }

  return (
    <>
      <span className="inline">
        {parts.map((part, idx) => {
          if (part.type === 'text') {
            return <span key={idx}>{renderItalicText(part.content)}</span>;
          }

          const isHovered = hoveredKeyword === `${part.link.wiki_id}-${idx}`;

          return (
            <button
              key={idx}
              onClick={() => setSelectedKeyword(isHovered ? null : { ...part.link, key: `${part.link.wiki_id}-${idx}` })}
              onMouseEnter={() => {
                setHoveredKeyword(`${part.link.wiki_id}-${idx}`);
                onKeywordHover?.(part.link);
              }}
              onMouseLeave={() => setHoveredKeyword(null)}
              className={`relative inline underline transition-all cursor-pointer ${
                isHovered
                  ? 'text-cyan-400 underline-offset-1'
                  : 'text-primary hover:text-cyan-400'
              }`}
              title={part.link.wiki_name}
            >
              {part.content}
              {isHovered && (
                <span className="absolute bottom-full left-0 mb-1 text-[8px] font-mono px-1.5 py-0.5 bg-cyan-900/80 text-cyan-200 rounded whitespace-nowrap border border-cyan-400/40 pointer-events-none">
                  {part.link.wiki_type}
                </span>
              )}
            </button>
          );
        })}
      </span>

      {/* Quick Reference Panel */}
      <AnimatePresence>
        {selectedKeyword && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mt-2 p-2.5 border border-cyan-400/30 bg-cyan-900/15 rounded text-[8px] font-mono space-y-1.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-cyan-400 font-semibold">{selectedKeyword.wiki_name}</p>
                  <p className="text-primary/50 uppercase tracking-widest">{selectedKeyword.wiki_type}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedKeyword(null)}
                className="text-primary/30 hover:text-primary/60 transition-colors flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {selectedKeyword.wiki_summary && (
              <p className="text-primary/70 leading-relaxed">{selectedKeyword.wiki_summary}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}