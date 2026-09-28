// Byte-level BPE, matching the Hugging Face `tokenizers` model phase 1 trains
// (ByteLevel pre-tokenizer, add_prefix_space=false, GPT-2 split regex, no
// normalizer). server/tools/make_web_fixtures.py records what Python makes of
// tricky strings; tokenizer.test.js holds this to it.

const SPLIT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
export const SPECIAL_STRINGS = ["<|endoftext|>", "<|user|>", "<|anima|>"];

/** GPT-2's reversible byte <-> printable-character table. */
function byteTables() {
  const bytes = [];
  for (let b = 33; b <= 126; b++) bytes.push(b);
  for (let b = 161; b <= 172; b++) bytes.push(b);
  for (let b = 174; b <= 255; b++) bytes.push(b);
  const chars = bytes.slice();
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    if (!bytes.includes(b)) {
      bytes.push(b);
      chars.push(256 + extra);
      extra += 1;
    }
  }
  const byteToChar = new Array(256);
  const charToByte = new Map();
  bytes.forEach((b, i) => {
    const ch = String.fromCharCode(chars[i]);
    byteToChar[b] = ch;
    charToByte.set(ch, b);
  });
  return { byteToChar, charToByte };
}

const { byteToChar, charToByte } = byteTables();
const utf8 = new TextEncoder();

export class ByteLevelBpe {
  /**
   * @param {{ vocab: Record<string, number>, merges: string[][] }} payload
   * @param {{ eot: number, user: number, anima: number }} special
   */
  constructor(payload, special) {
    this.vocab = new Map(Object.entries(payload.vocab));
    this.idToToken = new Map();
    for (const [token, id] of this.vocab) this.idToToken.set(id, token);
    this.ranks = new Map();
    payload.merges.forEach(([a, b], rank) => this.ranks.set(`${a} ${b}`, rank));
    this.special = special;
    this.specialIds = new Set(Object.values(special));
    this.cache = new Map();
  }

  /** BPE on one pre-token (already mapped to byte characters). */
  bpe(word) {
    const cached = this.cache.get(word);
    if (cached) return cached;
    let symbols = Array.from(word);
    while (symbols.length > 1) {
      let best = null;
      let bestRank = Infinity;
      for (let i = 0; i < symbols.length - 1; i++) {
        const rank = this.ranks.get(`${symbols[i]} ${symbols[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = [symbols[i], symbols[i + 1]];
        }
      }
      if (!best) break;
      const merged = [];
      for (let i = 0; i < symbols.length; i++) {
        if (i < symbols.length - 1 && symbols[i] === best[0] && symbols[i + 1] === best[1]) {
          merged.push(best[0] + best[1]);
          i += 1;
        } else {
          merged.push(symbols[i]);
        }
      }
      symbols = merged;
    }
    if (this.cache.size < 20_000) this.cache.set(word, symbols);
    return symbols;
  }

  /** Token ids for plain text (no special tokens are produced). */
  encode(text) {
    const ids = [];
    for (const piece of String(text).match(SPLIT) || []) {
      let mapped = "";
      for (const b of utf8.encode(piece)) mapped += byteToChar[b];
      for (const symbol of this.bpe(mapped)) {
        const id = this.vocab.get(symbol);
        if (id === undefined) throw new Error(`Tokenizer has no entry for "${symbol}".`);
        ids.push(id);
      }
    }
    return ids;
  }

  /** Message text as training saw it: role markers inside text are blanked. */
  encodeText(text) {
    let clean = String(text ?? "");
    for (const special of SPECIAL_STRINGS) clean = clean.split(special).join(" ");
    return this.encode(clean);
  }

  decode(ids) {
    const bytes = [];
    for (const id of ids) {
      if (this.specialIds.has(id)) continue;
      const token = this.idToToken.get(id);
      if (token === undefined) continue;
      for (const ch of token) {
        const b = charToByte.get(ch);
        if (b !== undefined) bytes.push(b);
      }
    }
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}
