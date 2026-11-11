import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "../src/lib/corsPolicy";

describe("isAllowedCorsOrigin", () => {
  it("allows the production hosts", () => {
    expect(isAllowedCorsOrigin("https://anima-protocol.com")).toBe(true);
    expect(isAllowedCorsOrigin("https://www.anima-protocol.com")).toBe(true);
    expect(isAllowedCorsOrigin("https://clerk.anima-protocol.com/")).toBe(true);
  });

  it("allows local dev and native shells", () => {
    expect(isAllowedCorsOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedCorsOrigin("capacitor://localhost")).toBe(true);
  });

  it("allows same-origin requests on any host, including previews", () => {
    expect(
      isAllowedCorsOrigin(
        "https://pr-12.anima-protocol.workers.dev",
        "pr-12.anima-protocol.workers.dev",
      ),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin(
        "http://pr-12.anima-protocol.workers.dev",
        "pr-12.anima-protocol.workers.dev",
      ),
    ).toBe(false);
  });

  it("rejects other sites, look-alikes and the null origin", () => {
    expect(isAllowedCorsOrigin("https://evil.example")).toBe(false);
    expect(isAllowedCorsOrigin("https://anima-protocol.com.evil.example")).toBe(false);
    expect(isAllowedCorsOrigin("http://anima-protocol.com")).toBe(false);
    expect(isAllowedCorsOrigin("null")).toBe(false);
    expect(isAllowedCorsOrigin(undefined)).toBe(false);
  });

  it("honours ANIMA_CORS_ALLOWED_ORIGINS", () => {
    const env = { ANIMA_CORS_ALLOWED_ORIGINS: "https://staging.example, https://other.example/" };
    expect(isAllowedCorsOrigin("https://staging.example", null, env)).toBe(true);
    expect(isAllowedCorsOrigin("https://other.example", null, env)).toBe(true);
    expect(isAllowedCorsOrigin("https://evil.example", null, env)).toBe(false);
  });
});
