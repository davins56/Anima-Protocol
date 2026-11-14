/**
 * AES-256-GCM for calendar OAuth tokens at rest and for the OAuth `state`.
 *
 * The repo had no encryption helper before this (checked: no createCipheriv,
 * crypto.subtle.encrypt or similar under artifacts/api-server or lib/db), so
 * this uses Web Crypto, which works the same on the Cloudflare Worker and in
 * Node 24. The key is the Worker secret ANIMA_CALENDAR_TOKEN_KEY: 32 random
 * bytes, base64 or base64url (e.g. `openssl rand -base64 32`).
 *
 * Format: "v1.<iv base64url>.<ciphertext+tag base64url>". The additional data
 * binds a ciphertext to its purpose and owner (e.g. "refresh:<user>:google"),
 * so a token row copied to another user or provider does not decrypt.
 */
import { readRuntimeEnv } from "../cloudflareEnv";

export const CALENDAR_TOKEN_KEY_ENV = "ANIMA_CALENDAR_TOKEN_KEY";
const VERSION = "v1";

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64Decode(text: string): Uint8Array<ArrayBuffer> {
  const norm = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Raw key bytes from the secret, or null when unset or not exactly 32 bytes. */
export function calendarKeyBytes(raw: string | undefined = readRuntimeEnv(CALENDAR_TOKEN_KEY_ENV)): Uint8Array | null {
  if (!raw || !raw.trim()) return null;
  try {
    const bytes = b64Decode(raw.trim());
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(keyBytes), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, aad: string, keyBytes: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyBytes);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plain),
  );
  return `${VERSION}.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

/** Null on any tampering, wrong key, wrong AAD, or malformed input. */
export async function decryptSecret(sealed: string, aad: string, keyBytes: Uint8Array): Promise<string | null> {
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  try {
    const key = await importKey(keyBytes);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64Decode(parts[1]), additionalData: new TextEncoder().encode(aad) },
      key,
      b64Decode(parts[2]),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** Random URL-safe string (PKCE verifier, nonces). */
export function randomToken(bytes = 32): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64urlEncode(new Uint8Array(digest));
}
