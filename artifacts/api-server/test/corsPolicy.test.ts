import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "../src/lib/corsPolicy";

describe("isAllowedCorsOrigin", () => {
  it("allows the production hosts", () => {
    expect(isAllowedCorsOrigin("https://anima-protocol.com")).toBe(true);
    expect(isAllowedCorsOrigin("https://www.anima-protocol.com")).toBe(true);
    expect(isAllowedCorsOrigin("https://clerk.anima-protocol.com/")).toBe(true);
  });

  it("allows local dev and native shells outside production", () => {
    const dev = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    expect(isAllowedCorsOrigin("http://localhost:5173", null, dev)).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8080", null, dev)).toBe(true);
    expect(isAllowedCorsOrigin("http://[::1]:3000", null, dev)).toBe(true);
    expect(isAllowedCorsOrigin("capacitor://localhost", null, dev)).toBe(true);
  });

  it("refuses loopback origins in production (audit L1) but keeps native shells", () => {
    const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    expect(isAllowedCorsOrigin("http://localhost:3000", null, prod)).toBe(false);
    expect(isAllowedCorsOrigin("https://localhost", null, prod)).toBe(false);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8080", null, prod)).toBe(false);
    expect(isAllowedCorsOrigin("http://[::1]:3000", null, prod)).toBe(false);
    expect(isAllowedCorsOrigin("capacitor://localhost", null, prod)).toBe(true);
    expect(isAllowedCorsOrigin("ionic://localhost", null, prod)).toBe(true);
    expect(isAllowedCorsOrigin("https://anima-protocol.com", null, prod)).toBe(true);
  });

  it("lets ANIMA_CORS_ALLOW_LOOPBACK override the environment default", () => {
    expect(
      isAllowedCorsOrigin("http://localhost:3000", null, {
        NODE_ENV: "production",
        ANIMA_CORS_ALLOW_LOOPBACK: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin("http://localhost:3000", null, {
        NODE_ENV: "development",
        ANIMA_CORS_ALLOW_LOOPBACK: "false",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
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
