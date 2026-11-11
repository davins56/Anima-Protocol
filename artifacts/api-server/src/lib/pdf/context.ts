import type { LlmProviderId } from "../llmFailover";
import { PDF_CONTEXT_MAX_HITS, PDF_CONTEXT_WORD_BUDGET } from "./limits";

/**
 * A normal word is whitespace-separated. A huge token with no spaces still
 * counts as several words so a spaceless dump cannot skip the budget.
 */
const LONG_TOKEN_CHARS = 24;

export function pdfWords(text: string): string[] {
  const trimmed = String(text || "")
    .trim()
    .replace(/…+$/u, "")
    .trim();
  if (!trimmed) return [];
  const out: string[] = [];
  for (const token of trimmed.split(/\s+/)) {
    if (!token) continue;
    if (token.length <= LONG_TOKEN_CHARS) {
      out.push(token);
      continue;
    }
    for (let i = 0; i < token.length; i += LONG_TOKEN_CHARS) {
      out.push(token.slice(i, i + LONG_TOKEN_CHARS));
    }
  }
  return out;
}

export function pdfWordCount(text: string): number {
  return pdfWords(text).length;
}

function takeWords(
  text: string,
  room: number,
): { text: string; words: number; truncated: boolean } {
  const words = pdfWords(text);
  if (room <= 0 || words.length === 0) {
    return { text: "", words: 0, truncated: words.length > 0 };
  }
  if (words.length <= room) {
    return { text: text.trim(), words: words.length, truncated: false };
  }
  return {
    text: `${words.slice(0, room).join(" ")}…`,
    words: room,
    truncated: true,
  };
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "this", "that", "it", "its", "i",
  "you", "we", "they", "me", "my", "your", "what", "whats", "how", "why",
  "when", "where", "who", "do", "does", "did", "can", "could", "would",
  "should", "please", "just", "about", "from", "at", "as", "if", "so",
  "not", "but", "have", "has", "had", "think", "tell", "pdf", "file",
  "document", "shared",
]);

/** Ids we will bind as query parameters. Never interpolated into SQL. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function safeEntityId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return SAFE_ID.test(id) ? id : null;
}

export function safeEntityIds(values: unknown[], max = 12): string[] {
  const out: string[] = [];
  const list = Array.isArray(values) ? values : [];
  for (const value of list) {
    const id = safeEntityId(value);
    if (!id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * PDF excerpts go to the self-hosted anima-chat model only.
 * Any chain that can hop to Workers AI or OpenRouter gets no PDF text.
 */
export function chatMayIncludePdfContext(
  chain: readonly LlmProviderId[],
): boolean {
  return chain.length > 0 && chain.every((provider) => provider === "local");
}

/** Content words for Postgres `to_tsquery`. Empty means "no keyword search". */
export function pdfSearchTerms(query: string, max = 8): string[] {
  const words = String(query || "").toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const out: string[] = [];
  for (const word of words) {
    if (STOP_WORDS.has(word) || out.includes(word)) continue;
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

/** OR-prefix tsquery. Tokens are already `[a-z0-9]+`, so this cannot inject SQL. */
export function pdfTsQuery(terms: string[]): string {
  return terms.map((term) => `${term}:*`).join(" | ");
}

export function sanitizePdfFilename(name: unknown): string {
  const base = String(name || "document.pdf")
    .split(/[/\\]/)
    .pop()
    ?.replace(/[^\w.\- ()[\]]+/g, "")
    .trim()
    .slice(0, 180) || "document.pdf";
  if (!base.toLowerCase().endsWith(".pdf")) {
    return `${base || "document"}.pdf`;
  }
  return base || "document.pdf";
}

export type PdfHit = {
  filename: string;
  scope: "chat" | "lore";
  pageStart: number;
  pageEnd: number;
  content: string;
  rank: number;
};

export type PdfFileSummary = {
  filename: string;
  scope: string;
  pageCount: number;
};

/**
 * Fit file names plus the best excerpts into PDF_CONTEXT_WORD_BUDGET.
 * Chat hits and lore hits share that one budget. The returned string is
 * what may be appended to the system prompt.
 */
export function packPdfContext(
  input: {
    files?: PdfFileSummary[];
    hits?: PdfHit[];
    fallback?: PdfHit | null;
  },
  budget = PDF_CONTEXT_WORD_BUDGET,
): string {
  const files = input.files ?? [];
  const hits = (input.hits ?? []).slice(0, PDF_CONTEXT_MAX_HITS);
  const excerpts = hits.length ? hits : input.fallback ? [input.fallback] : [];
  if (!files.length && !excerpts.length) return "";

  const intro =
    "REFERENCE EXCERPTS from PDFs the user shared. Use only this text. Do not invent pages you were not given.";
  const fileLine = files.length
    ? `Files: ${files
        .slice(0, 8)
        .map((file) => `${file.scope} "${file.filename}" (${file.pageCount}p)`)
        .join("; ")}`
    : "";

  const pieces: string[] = [];
  let used = 0;
  const add = (text: string): boolean => {
    const taken = takeWords(text, budget - used);
    if (!taken.text) return false;
    pieces.push(taken.text);
    used += taken.words;
    return !taken.truncated;
  };

  if (!add(intro)) return pieces.join("\n\n");
  if (fileLine) add(fileLine);
  for (const hit of excerpts) {
    if (used >= budget) break;
    const pageLabel =
      hit.pageEnd > hit.pageStart ? `p.${hit.pageStart}–${hit.pageEnd}` : `p.${hit.pageStart}`;
    const header = `From ${hit.filename} (${hit.scope}, ${pageLabel}):`;
    if (!add(`${header}\n${hit.content}`)) break;
  }
  return pieces.join("\n\n");
}

/**
 * Last-line cap used by the prompt builder so a bug upstream cannot
 * push a whole PDF into the model. Chat and lore share this word budget.
 */
export function capPdfPromptBlock(
  block: string | null | undefined,
  budget = PDF_CONTEXT_WORD_BUDGET,
): string {
  const text = String(block || "").trim();
  if (!text) return "";
  const words = pdfWords(text);
  if (words.length <= budget) return text;
  return `${words.slice(0, budget).join(" ")}…`;
}

/**
 * Shrink a PDF excerpt so it fits both the word cap and the leftover
 * characters in the history/context budget. Returns "" when there is no
 * room — callers must not trim persona, mood, or memory to make space.
 */
export function fitPdfToRoom(
  block: string | null | undefined,
  roomChars: number,
  wordBudget = PDF_CONTEXT_WORD_BUDGET,
): string {
  const capped = capPdfPromptBlock(block, wordBudget);
  if (!capped || roomChars <= 0) return "";
  if (capped.length <= roomChars) return capped;
  const words = pdfWords(capped);
  let acc = "";
  for (const word of words) {
    const next = acc ? `${acc} ${word}` : word;
    if (`${next}…`.length > roomChars) break;
    acc = next;
  }
  if (!acc) return "";
  return `${acc}…`;
}

const LOYALTY_MARKER = "HIGHEST-PRIORITY RULE";

/**
 * Place PDF text after persona, mood, and memory. The loyalty guardrail
 * stays after the excerpt so it is not pushed out of the prompt.
 */
export function appendPdfAfterContext(base: string, pdf: string): string {
  const block = String(pdf || "").trim();
  if (!block) return base;
  const idx = base.lastIndexOf(LOYALTY_MARKER);
  if (idx < 0) return `${base.trimEnd()}\n\n${block}`;
  const head = base.slice(0, idx).trimEnd();
  const tail = base.slice(idx);
  return `${head}\n\n${block}\n\n${tail}`;
}

type PdfSqlMode = "search" | "fallback" | "files";

/**
 * Retrieval SQL. `userId` is always `$1` on both the chunk and document
 * sides. The caller's message is never concatenated into the statement;
 * the tsquery (when present) is a bound parameter.
 */
export function buildPdfRetrievalSql(params: {
  userId: string;
  sessionId: string | null;
  characterIds: string[];
  tsQuery: string | null;
  mode: PdfSqlMode;
}): { text: string; values: unknown[] } | null {
  const userId = safeEntityId(params.userId);
  if (!userId) return null;
  const sessionId = params.sessionId ? safeEntityId(params.sessionId) : null;
  const characterIds = safeEntityIds(params.characterIds);
  if (!sessionId && characterIds.length === 0) return null;

  const values: unknown[] = [userId];
  const scopeParts: string[] = [];
  if (sessionId) {
    values.push(sessionId);
    scopeParts.push(`(d.scope = 'chat' AND d.session_id = $${values.length})`);
  }
  if (characterIds.length && params.mode !== "fallback") {
    const placeholders: string[] = [];
    for (const id of characterIds) {
      values.push(id);
      placeholders.push(`$${values.length}`);
    }
    scopeParts.push(
      `(d.scope = 'lore' AND d.character_id IN (${placeholders.join(", ")}))`,
    );
  }
  if (!scopeParts.length) return null;
  const scopeSql = scopeParts.join(" OR ");
  const ownerSql = `c.user_id = $1 AND d.user_id = $1 AND (${scopeSql})`;

  if (params.mode === "files") {
    return {
      text: `SELECT d.filename, d.scope, d.page_count
             FROM pdf_documents d
             WHERE d.user_id = $1 AND (${scopeSql})
             ORDER BY d.created_at ASC
             LIMIT 12`,
      values,
    };
  }

  if (params.mode === "fallback") {
    if (!sessionId) return null;
    return {
      text: `SELECT c.content, c.page_start, c.page_end, d.filename, d.scope, 0 AS rank
             FROM pdf_chunks c
             JOIN pdf_documents d ON d.id = c.document_id AND d.user_id = c.user_id
             WHERE ${ownerSql} AND c.chunk_index = 0
             ORDER BY d.created_at DESC
             LIMIT 1`,
      values,
    };
  }

  const tsQuery = String(params.tsQuery || "").trim();
  if (!tsQuery) return null;
  values.push(tsQuery);
  const queryParam = `$${values.length}`;
  return {
    text: `SELECT c.content, c.page_start, c.page_end, d.filename, d.scope,
                  ts_rank_cd(c.search_vector, to_tsquery('english', ${queryParam})) AS rank
           FROM pdf_chunks c
           JOIN pdf_documents d ON d.id = c.document_id AND d.user_id = c.user_id
           WHERE ${ownerSql}
             AND c.search_vector @@ to_tsquery('english', ${queryParam})
           ORDER BY rank DESC, c.chunk_index ASC
           LIMIT ${PDF_CONTEXT_MAX_HITS}`,
    values,
  };
}
