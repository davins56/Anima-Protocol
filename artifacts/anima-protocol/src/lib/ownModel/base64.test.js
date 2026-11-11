import { afterEach, describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64.js";

const native = { from: Uint8Array.fromBase64, to: Uint8Array.prototype.toBase64 };

describe("base64", () => {
  afterEach(() => {
    Uint8Array.fromBase64 = native.from;
    Uint8Array.prototype.toBase64 = native.to;
  });

  const sizes = [0, 1, 2, 3, 70_000];
  const sample = (n) => new Uint8Array(n).map((_, i) => (i * 131 + 7) & 0xff);

  it.each(sizes)("round-trips %i bytes like Node's Buffer", (n) => {
    const bytes = sample(n);
    const text = bytesToBase64(bytes);
    expect(text).toBe(Buffer.from(bytes).toString("base64"));
    expect(Array.from(base64ToBytes(`${text}\n`))).toEqual(Array.from(bytes));
  });

  it("works without the native helpers", () => {
    delete Uint8Array.fromBase64;
    delete Uint8Array.prototype.toBase64;
    const bytes = sample(70_000);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(Buffer.from(base64ToBytes(Buffer.from(bytes).toString("base64"))).equals(Buffer.from(bytes))).toBe(true);
  });
});
