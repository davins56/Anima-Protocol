// Model chunks travel as base64 text (see the api-server's readBlobChunk).
// Native Uint8Array.fromBase64 / toBase64 where the browser has them.

export function base64ToBytes(text) {
  const clean = String(text).trim();
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(clean);
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
