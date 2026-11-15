/** 32-bit FNV-1a over UTF-16 code units. Same result in Node and the browser. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function fnv1aHex(input: string): string {
  return `fnv1a:${fnv1a(input).toString(16).padStart(8, "0")}`;
}
