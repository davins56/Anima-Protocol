import { detectLoreKeywords, createLoreSegments } from "@/utils/loreKeywordDetector";
import LoreKeywordTooltip from "./LoreKeywordTooltip";

export default function LoreTextWithKeywords({ content, loreEntries }) {
  const matches = detectLoreKeywords(content, loreEntries);
  const segments = createLoreSegments(content, matches);

  return (
    <>
      {segments.map((segment, idx) =>
        segment.type === "keyword" ? (
          <LoreKeywordTooltip
            key={idx}
            keyword={segment.content}
            loreEntry={segment.entry}
          >
            {segment.content}
          </LoreKeywordTooltip>
        ) : (
          <span key={idx}>{segment.content}</span>
        )
      )}
    </>
  );
}