import { describe, expect, it } from "vitest";

import {
  isStoreDatabaseError,
  isStoreReadUnavailable,
} from "./storeErrorSignals";
import {
  STORE_UNREACHABLE_MESSAGE,
  parseStoreErrorDetail,
} from "@/api/base44Client";

/** Shape the API error handler produces for a real database fault. */
function serverDbError(reason = "unavailable") {
  return Object.assign(new Error("Database unavailable"), {
    status: 503,
    dbError: true,
    reason,
    code: "internal",
  });
}

/** Shape the API produces when a store route throws for a non-DB reason. */
function serverStoreError() {
  return Object.assign(
    new Error("The companion store is temporarily unavailable."),
    { status: 503, dbError: false, reason: "internal", code: "store_unavailable" },
  );
}

/** Client-side timeout from storeFetch(). */
function clientTimeout() {
  return Object.assign(
    new Error(
      "The server took too long to respond. Check your connection or try again in a moment.",
    ),
    { code: "timeout" },
  );
}

describe("isStoreDatabaseError", () => {
  it("trusts an explicit server verdict", () => {
    expect(isStoreDatabaseError(serverDbError())).toBe(true);
    expect(isStoreDatabaseError(serverStoreError())).toBe(false);
  });

  it("accepts every DbErrorReason the API can emit", () => {
    for (const reason of [
      "auth",
      "limit",
      "refused",
      "reset",
      "schema",
      "ssl",
      "timeout",
      "unavailable",
      "unreachable",
    ]) {
      expect(
        isStoreDatabaseError({ status: 503, reason }),
        `reason=${reason}`,
      ).toBe(true);
    }
  });

  it("does not treat reason 'internal' as a database fault", () => {
    // classifyDbError() returns "internal" exactly when isDbError is false.
    expect(isStoreDatabaseError({ status: 503, reason: "internal" })).toBe(false);
  });

  // --- the regressions this module exists to prevent ---

  it("does not call a request timeout a database outage", () => {
    // The old rule matched the word "connection" in the timeout copy.
    expect(isStoreDatabaseError(clientTimeout())).toBe(false);
  });

  it("does not call a Cloudflare / edge error page a database outage", () => {
    const edge = Object.assign(new Error(STORE_UNREACHABLE_MESSAGE), {
      status: 503,
      transport: true,
    });
    expect(isStoreDatabaseError(edge)).toBe(false);
  });

  it("does not treat a bare 503 as a database outage", () => {
    // The old rule was `status === 503 -> true`, which is why any store-route
    // bug was reported to users as the database being down.
    expect(isStoreDatabaseError({ status: 503, message: "Nope" })).toBe(false);
  });

  it("does not match the word 'unavailable' or 'connection' alone", () => {
    expect(isStoreDatabaseError({ message: "Service unavailable" })).toBe(false);
    expect(isStoreDatabaseError({ message: "Check your connection" })).toBe(false);
  });

  it("still recognises legacy prose when no structured reason is present", () => {
    expect(isStoreDatabaseError({ message: "Database unavailable" })).toBe(true);
    expect(isStoreDatabaseError({ message: "postgres is down" })).toBe(true);
  });

  it("is safe on non-objects", () => {
    for (const v of [null, undefined, "boom", 503]) {
      expect(isStoreDatabaseError(v)).toBe(false);
    }
  });
});

describe("isStoreReadUnavailable", () => {
  it("covers database faults", () => {
    expect(isStoreReadUnavailable(serverDbError())).toBe(true);
  });

  it("still covers non-database store failures, so the bundled roster shows", () => {
    // Behaviour preserved: the fallback is about not showing an empty library,
    // which applies whatever the cause.
    expect(isStoreReadUnavailable(serverStoreError())).toBe(true);
    expect(isStoreReadUnavailable(clientTimeout())).toBe(true);
    expect(
      isStoreReadUnavailable({ status: 503, transport: true }),
    ).toBe(true);
  });

  it("does not hide an auth failure behind a fake roster", () => {
    expect(isStoreReadUnavailable({ status: 401 })).toBe(false);
    expect(isStoreReadUnavailable({ status: 403 })).toBe(false);
  });

  it("ignores ordinary client errors", () => {
    expect(isStoreReadUnavailable({ status: 400 })).toBe(false);
    expect(isStoreReadUnavailable({ status: 404 })).toBe(false);
  });
});

describe("parseStoreErrorDetail", () => {
  it("carries the server verdict through instead of re-guessing from prose", async () => {
    const res = new Response(
      JSON.stringify({
        error: "Database connection timed out",
        dbError: true,
        reason: "timeout",
        code: "ETIMEOUT",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
    await expect(parseStoreErrorDetail(res)).resolves.toEqual({
      message: "Database connection timed out",
      dbError: true,
      reason: "timeout",
      code: "ETIMEOUT",
    });
  });

  it("marks a non-JSON body as transport, not as a database fault", async () => {
    const res = new Response("<!DOCTYPE html><html><body>1101</body></html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
    const detail = await parseStoreErrorDetail(res);
    expect(detail).toMatchObject({ transport: true });
    expect(detail.dbError).toBeUndefined();
    expect(detail.message).not.toMatch(/database/i);
  });

  it("no longer tells the user the database could not be reached", () => {
    expect(STORE_UNREACHABLE_MESSAGE).not.toMatch(/database/i);
  });
});
