import { describe, expect, it, vi } from "vitest";
import {
  AFFIRMATION_ADD_FAILED,
  AFFIRMATION_AUTH_REQUIRED,
  AFFIRMATION_EMPTY_TEXT,
  AFFIRMATION_LOAD_FAILED,
  AFFIRMATION_SEED_FAILED,
  affirmationErrorMessage,
  createUserAffirmation,
  loadAndSeedAffirmations,
  validateAddAffirmation,
} from "./affirmationStore";

describe("validateAddAffirmation", () => {
  it("rejects blank text before auth so the Add button can stay enabled", () => {
    expect(validateAddAffirmation({ text: "   ", user: { email: "a@b.c" } })).toBe(
      AFFIRMATION_EMPTY_TEXT,
    );
  });

  it("rejects a missing session instead of silently returning", () => {
    expect(validateAddAffirmation({ text: "I am safe.", user: null })).toBe(
      AFFIRMATION_AUTH_REQUIRED,
    );
    expect(validateAddAffirmation({ text: "I am safe.", user: {} })).toBe(
      AFFIRMATION_AUTH_REQUIRED,
    );
  });

  it("accepts a signed-in user with text", () => {
    expect(
      validateAddAffirmation({ text: "I am safe.", user: { email: "a@b.c" } }),
    ).toBeNull();
  });
});

describe("affirmationErrorMessage", () => {
  it("does not swallow store / DB messages", () => {
    expect(
      affirmationErrorMessage(new Error("Database unavailable"), "fallback"),
    ).toBe("Database unavailable");
  });

  it("maps 401/403 to a sign-in message", () => {
    const err = new Error("Unauthorized");
    err.status = 401;
    expect(affirmationErrorMessage(err, "fallback")).toBe(
      AFFIRMATION_AUTH_REQUIRED,
    );
  });

  it("uses the fallback when the failure has no message", () => {
    expect(affirmationErrorMessage(new Error(""), AFFIRMATION_ADD_FAILED)).toBe(
      AFFIRMATION_ADD_FAILED,
    );
  });
});

describe("createUserAffirmation", () => {
  it("throws a visible auth error and does not call create", async () => {
    const create = vi.fn();
    await expect(
      createUserAffirmation({
        user: null,
        text: "I heal.",
        category: "healing",
        create,
      }),
    ).rejects.toThrow(AFFIRMATION_AUTH_REQUIRED);
    expect(create).not.toHaveBeenCalled();
  });

  it("surfaces the store error when create fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Database unavailable"));
    await expect(
      createUserAffirmation({
        user: { email: "a@b.c" },
        text: "  I heal.  ",
        category: "healing",
        create,
      }),
    ).rejects.toThrow("Database unavailable");
    expect(create).toHaveBeenCalledWith({
      text: "I heal.",
      category: "healing",
      user_email: "a@b.c",
      is_active: true,
    });
  });

  it("returns the created row on success", async () => {
    const created = { id: "1", text: "I heal." };
    const create = vi.fn().mockResolvedValue(created);
    await expect(
      createUserAffirmation({
        user: { email: "a@b.c" },
        text: "I heal.",
        category: "healing",
        create,
      }),
    ).resolves.toBe(created);
  });
});

describe("loadAndSeedAffirmations", () => {
  const defaults = [{ text: "I am here.", category: "healing" }];

  it("throws when auth is missing", async () => {
    const filter = vi.fn();
    const create = vi.fn();
    await expect(
      loadAndSeedAffirmations({ user: null, filter, create, defaults }),
    ).rejects.toThrow(AFFIRMATION_AUTH_REQUIRED);
    expect(filter).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("surfaces filter failures instead of leaving an empty list", async () => {
    const filter = vi.fn().mockRejectedValue(new Error("Database host unreachable"));
    await expect(
      loadAndSeedAffirmations({
        user: { email: "a@b.c" },
        filter,
        create: vi.fn(),
        defaults,
      }),
    ).rejects.toThrow("Database host unreachable");
  });

  it("surfaces seed failures when the user has no rows", async () => {
    const filter = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockRejectedValue(new Error("Database unavailable"));
    await expect(
      loadAndSeedAffirmations({
        user: { email: "a@b.c" },
        filter,
        create,
        defaults,
      }),
    ).rejects.toMatchObject({ message: "Database unavailable" });
  });

  it("returns existing rows without seeding", async () => {
    const existing = [{ id: "1", text: "Mine" }];
    const create = vi.fn();
    await expect(
      loadAndSeedAffirmations({
        user: { email: "a@b.c" },
        filter: vi.fn().mockResolvedValue(existing),
        create,
        defaults,
      }),
    ).resolves.toEqual(existing);
    expect(create).not.toHaveBeenCalled();
  });

  it("uses a load fallback when filter throws an empty error", async () => {
    await expect(
      loadAndSeedAffirmations({
        user: { email: "a@b.c" },
        filter: vi.fn().mockRejectedValue(new Error("")),
        create: vi.fn(),
        defaults,
      }),
    ).rejects.toThrow(AFFIRMATION_LOAD_FAILED);
  });

  it("uses a seed fallback when create throws an empty error", async () => {
    await expect(
      loadAndSeedAffirmations({
        user: { email: "a@b.c" },
        filter: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockRejectedValue(new Error("")),
        defaults,
      }),
    ).rejects.toThrow(AFFIRMATION_SEED_FAILED);
  });
});
