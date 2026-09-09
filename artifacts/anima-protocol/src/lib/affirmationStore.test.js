import { describe, expect, it, vi } from "vitest";
import {
  AFFIRMATION_ADD_FAILED,
  AFFIRMATION_AUTH_REQUIRED,
  AFFIRMATION_EMPTY_TEXT,
  AFFIRMATION_LOAD_FAILED,
  AFFIRMATION_LOAD_TIMEOUT,
  AFFIRMATION_SEED_FAILED,
  LOCAL_AFFIRMATION_ID_PREFIX,
  affirmationErrorMessage,
  asLocalAffirmations,
  createUserAffirmation,
  loadAffirmations,
  loadAndSeedAffirmations,
  loadSacredSpaceSnapshot,
  seedDefaultAffirmations,
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

describe("asLocalAffirmations", () => {
  it("assigns local ids so first paint can render without the store", () => {
    const rows = asLocalAffirmations([
      { text: "I am here.", category: "healing" },
    ]);
    expect(rows).toEqual([
      {
        text: "I am here.",
        category: "healing",
        id: `${LOCAL_AFFIRMATION_ID_PREFIX}0`,
        is_default: true,
        is_active: true,
        is_local: true,
      },
    ]);
  });
});

describe("loadAffirmations", () => {
  it("throws when auth is missing", async () => {
    const filter = vi.fn();
    await expect(loadAffirmations({ user: null, filter })).rejects.toThrow(
      AFFIRMATION_AUTH_REQUIRED,
    );
    expect(filter).not.toHaveBeenCalled();
  });

  it("returns existing rows", async () => {
    const existing = [{ id: "1", text: "Mine" }];
    await expect(
      loadAffirmations({
        user: { email: "a@b.c" },
        filter: vi.fn().mockResolvedValue(existing),
      }),
    ).resolves.toEqual(existing);
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

  it("returns in-memory defaults immediately and reports a background seed failure", async () => {
    const filter = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockRejectedValue(new Error("Database unavailable"));
    const onSeedError = vi.fn();
    await expect(
      loadAndSeedAffirmations({
        user: { email: "a@b.c" },
        filter,
        create,
        defaults,
        onSeedError,
      }),
    ).resolves.toEqual(asLocalAffirmations(defaults));
    await vi.waitFor(() => {
      expect(onSeedError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Database unavailable" }),
      );
    });
  });

  it("surfaces blocking seed failures when seedInBackground is false", async () => {
    const filter = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockRejectedValue(new Error("Database unavailable"));
    await expect(
      loadAndSeedAffirmations({
        user: { email: "a@b.c" },
        filter,
        create,
        defaults,
        seedInBackground: false,
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
      seedDefaultAffirmations({
        user: { email: "a@b.c" },
        create: vi.fn().mockRejectedValue(new Error("")),
        defaults,
      }),
    ).rejects.toThrow(AFFIRMATION_SEED_FAILED);
  });

  it("does not wait on a hung seed create when seeding in the background", async () => {
    const filter = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockReturnValue(new Promise(() => {}));
    const result = await loadAndSeedAffirmations({
      user: { email: "a@b.c" },
      filter,
      create,
      defaults,
    });
    expect(result).toEqual(asLocalAffirmations(defaults));
  });
});

describe("loadSacredSpaceSnapshot", () => {
  const user = { email: "a@b.c" };
  const accountRows = [{ id: "mine", text: "My affirmation", category: "healing" }];

  it("waits for store auth before arming the list timeout", async () => {
    const events = [];
    const waitForAuth = vi.fn(async () => {
      events.push("auth");
      return "token";
    });
    const filter = vi.fn(async () => {
      events.push("filter");
      return accountRows;
    });

    const result = await loadSacredSpaceSnapshot({
      loadUser: async () => {
        events.push("me");
        return user;
      },
      filter,
      waitForAuth,
      listTimeoutMs: 50,
    });

    expect(events).toEqual(["auth", "me", "filter"]);
    expect(result.existing).toEqual(accountRows);
    expect(waitForAuth).toHaveBeenCalledTimes(1);
  });

  it("starts Affirmation.filter from peek email without waiting for auth.me", async () => {
    const events = [];
    const waitForAuth = vi.fn(async () => {
      events.push("auth");
      return "token";
    });
    let resolveMe;
    const loadUser = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveMe = resolve;
          events.push("me-started");
        }),
    );
    const filter = vi.fn(async () => {
      events.push("filter");
      return accountRows;
    });

    const result = await loadSacredSpaceSnapshot({
      loadUser,
      peekUser: () => {
        events.push("peek");
        return user;
      },
      filter,
      waitForAuth,
      listTimeoutMs: 50,
      userTimeoutMs: 20,
    });

    expect(events[0]).toBe("auth");
    expect(events[1]).toBe("peek");
    expect(events).toContain("filter");
    expect(events).toContain("me-started");
    expect(events.indexOf("peek")).toBeLessThan(events.indexOf("filter"));
    expect(result.existing).toEqual(accountRows);
    expect(result.me).toEqual(user);
    expect(filter).toHaveBeenCalledTimes(1);
    resolveMe?.({ email: "late@b.c" });
  });

  it("waits for Clerk email on peek instead of timing out a hung auth.me", async () => {
    let email = "";
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const peekUser = vi.fn(() => (email ? { email } : {}));
    const loadUser = vi.fn(() => new Promise(() => {}));
    const filter = vi.fn(async () => accountRows);

    const pending = loadSacredSpaceSnapshot({
      loadUser,
      peekUser,
      filter,
      waitForAuth,
      authWaitMs: 80,
      userTimeoutMs: 15,
      listTimeoutMs: 50,
    });
    await new Promise((r) => setTimeout(r, 30));
    email = user.email;
    await expect(pending).resolves.toMatchObject({
      existing: accountRows,
      me: { email: user.email },
    });
    expect(filter).toHaveBeenCalledTimes(1);
    expect(loadUser).toHaveBeenCalled();
  });

  it("does not paint AFFIRMATION_LOAD_TIMEOUT when auth.me hangs after peek", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const loadUser = vi.fn(() => new Promise(() => {}));
    const filter = vi.fn(async () => accountRows);

    await expect(
      loadSacredSpaceSnapshot({
        loadUser,
        peekUser: () => user,
        filter,
        waitForAuth,
        listTimeoutMs: 50,
        userTimeoutMs: 15,
      }),
    ).resolves.toMatchObject({ existing: accountRows, me: user });
    expect(filter).toHaveBeenCalledTimes(1);
    expect(waitForAuth).toHaveBeenCalledTimes(1);
  });

  it("keeps a filter that outlasts listTimeoutMs when slack covers token work", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const filter = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return accountRows;
    });

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => user,
        peekUser: () => user,
        filter,
        waitForAuth,
        listTimeoutMs: 20,
        listTimeoutSlackMs: 25,
      }),
    ).resolves.toMatchObject({ existing: accountRows });
    expect(filter).toHaveBeenCalledTimes(1);
  });

  it("does not classify an empty signed-in filter as a timeout", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const filter = vi.fn(async () => []);

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => user,
        peekUser: () => user,
        filter,
        waitForAuth,
        listTimeoutMs: 50,
      }),
    ).resolves.toMatchObject({ existing: [], me: user });
    expect(filter).toHaveBeenCalledTimes(1);
  });

  it("does not treat a slow auth wait as a list timeout", async () => {
    let authDone = false;
    const waitForAuth = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      authDone = true;
      return "token";
    });
    const filter = vi.fn(async () => {
      expect(authDone).toBe(true);
      return accountRows;
    });

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => user,
        filter,
        waitForAuth,
        // Shorter than the auth wait — must not cover minting.
        listTimeoutMs: 25,
      }),
    ).resolves.toMatchObject({ existing: accountRows });
    expect(waitForAuth).toHaveBeenCalledTimes(1);
    expect(filter).toHaveBeenCalledTimes(1);
  });

  it("retries once after auth settles when the first list times out", async () => {
    const timeout = Object.assign(
      new Error("The server took too long to respond. Check your connection."),
      { code: "timeout" },
    );
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const filter = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(accountRows);

    const result = await loadSacredSpaceSnapshot({
      loadUser: async () => user,
      filter,
      waitForAuth,
      listTimeoutMs: 80,
    });

    expect(waitForAuth).toHaveBeenCalledTimes(2);
    expect(filter).toHaveBeenCalledTimes(2);
    expect(result.existing).toEqual(accountRows);
  });

  it("throws the timeout banner only after the retry also times out", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const filter = vi.fn().mockReturnValue(new Promise(() => {}));

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => user,
        filter,
        waitForAuth,
        listTimeoutMs: 20,
      }),
    ).rejects.toMatchObject({
      message: AFFIRMATION_LOAD_TIMEOUT,
      code: "timeout",
    });
    expect(waitForAuth).toHaveBeenCalledTimes(2);
    expect(filter).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-timeout store failures", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const filter = vi.fn().mockRejectedValue(new Error("Database host unreachable"));

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => user,
        filter,
        waitForAuth,
      }),
    ).rejects.toThrow("Database host unreachable");
    expect(filter).toHaveBeenCalledTimes(1);
    expect(waitForAuth).toHaveBeenCalledTimes(1);
  });

  it("does not treat a slow auth.me as an affirmation list timeout", async () => {
    let meDone = false;
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const filter = vi.fn(async () => {
      expect(meDone).toBe(true);
      return accountRows;
    });

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => {
          await new Promise((r) => setTimeout(r, 40));
          meDone = true;
          return user;
        },
        filter,
        waitForAuth,
        // Shorter than auth.me — #434's shared snapshot budget failed here.
        listTimeoutMs: 25,
        userTimeoutMs: 80,
      }),
    ).resolves.toMatchObject({ existing: accountRows });
    expect(filter).toHaveBeenCalledTimes(1);
    expect(waitForAuth).toHaveBeenCalledTimes(1);
  });

  it("does not share one STORE_FETCH window across Affirmation.filter and Anima.list", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const animas = [
      { id: "anima-1", name: "Serenity", assigned_user: "a@b.c" },
    ];

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => user,
        filter: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return accountRows;
        },
        listAnimas: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return animas;
        },
        waitForAuth,
        // Each 30ms leg fits its own 45ms budget. #434's shared 45ms
        // Promise.all window would abort the second leg.
        listTimeoutMs: 45,
        rosterTimeoutMs: 45,
        userTimeoutMs: 20,
      }),
    ).resolves.toMatchObject({
      existing: accountRows,
      animas,
    });
    expect(waitForAuth).toHaveBeenCalledTimes(1);
  });

  it("does not treat a hung Character.list as sticky default affirmations", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const filter = vi.fn(async () => accountRows);
    const listCharacters = vi.fn(() => new Promise(() => {}));
    const listAnimas = vi.fn(() => new Promise(() => {}));

    await expect(
      loadSacredSpaceSnapshot({
        loadUser: async () => user,
        filter,
        listAnimas,
        listCharacters,
        waitForAuth,
        listTimeoutMs: 80,
        rosterTimeoutMs: 20,
      }),
    ).resolves.toMatchObject({
      existing: accountRows,
      animas: [],
      chars: [],
    });
    expect(filter).toHaveBeenCalledTimes(1);
    expect(waitForAuth).toHaveBeenCalledTimes(1);
  });

  it("delivers a late roster without failing the affirmation list", async () => {
    const waitForAuth = vi.fn().mockResolvedValue("token");
    const onRoster = vi.fn();
    let resolveChars;
    const listCharacters = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveChars = resolve;
        }),
    );

    const pending = loadSacredSpaceSnapshot({
      loadUser: async () => user,
      filter: async () => accountRows,
      listCharacters,
      waitForAuth,
      listTimeoutMs: 80,
      rosterTimeoutMs: 15,
      onRoster,
    });

    const result = await pending;
    expect(result.existing).toEqual(accountRows);
    expect(result.chars).toEqual([]);

    resolveChars([{ id: "char-1", name: "Nyx" }]);
    await vi.waitFor(() => {
      expect(onRoster).toHaveBeenCalledWith({
        me: user,
        animas: [],
        chars: [{ id: "char-1", name: "Nyx" }],
      });
    });
  });
});
