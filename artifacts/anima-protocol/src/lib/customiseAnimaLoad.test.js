import { describe, expect, it } from "vitest";
import {
  classifyCustomiseAnimaLoadError,
  customiseAnimaLoadCopy,
} from "./customiseAnimaLoad";

function err(message, status) {
  const error = new Error(message);
  if (status != null) error.status = status;
  return error;
}

describe("classifyCustomiseAnimaLoadError", () => {
  it("treats missing env as misconfigured, not a database outage", () => {
    expect(
      classifyCustomiseAnimaLoadError(
        err("API is misconfigured on the server. Check environment variables.", 503),
      ),
    ).toBe("misconfigured");
    expect(
      classifyCustomiseAnimaLoadError(
        err("Missing required environment variable: CLERK_SECRET_KEY"),
      ),
    ).toBe("misconfigured");
    expect(
      classifyCustomiseAnimaLoadError(
        err("DATABASE_URL must be set. Did you forget to provision a database?"),
      ),
    ).toBe("misconfigured");
  });

  it("treats 401 / session copy as unsigned-in", () => {
    expect(classifyCustomiseAnimaLoadError(err("Unauthorized", 401))).toBe(
      "unsigned",
    );
    expect(
      classifyCustomiseAnimaLoadError(
        err(
          "Not signed in — your session may have expired. Sign out and sign in again, then retry.",
          401,
        ),
      ),
    ).toBe("unsigned");
    expect(
      classifyCustomiseAnimaLoadError(
        err("Session not recognized by the server — sign out, sign back in, and try again."),
      ),
    ).toBe("unsigned");
  });

  it("treats reachable-config / unreachable-Postgres as database", () => {
    expect(
      classifyCustomiseAnimaLoadError(err("Database unavailable", 503)),
    ).toBe("database");
    expect(
      classifyCustomiseAnimaLoadError(err("Database host unreachable", 503)),
    ).toBe("database");
    expect(
      classifyCustomiseAnimaLoadError(err("Database connection refused")),
    ).toBe("database");
  });

  it("does not classify a generic 500 as misconfigured", () => {
    expect(
      classifyCustomiseAnimaLoadError(err("Internal server error", 500)),
    ).toBe("unknown");
  });
});

describe("customiseAnimaLoadCopy", () => {
  it("keeps distinct headlines so the hub is not one misconfigured banner", () => {
    const misconfigured = customiseAnimaLoadCopy("misconfigured");
    const unsigned = customiseAnimaLoadCopy("unsigned");
    const database = customiseAnimaLoadCopy("database", "Database unavailable");
    const empty = customiseAnimaLoadCopy("empty");

    expect(misconfigured.headline).toMatch(/misconfigured/i);
    expect(unsigned.headline).toMatch(/Sign in/i);
    expect(database.headline).toMatch(/database/i);
    expect(empty.headline).toMatch(/No personal Anima/i);

    expect(new Set([
      misconfigured.headline,
      unsigned.headline,
      database.headline,
      empty.headline,
    ]).size).toBe(4);

    expect(misconfigured.showForge).toBe(false);
    expect(unsigned.showSignIn).toBe(true);
    expect(empty.showForge).toBe(true);
    expect(database.body).toMatch(/Database unavailable/);
  });
});
