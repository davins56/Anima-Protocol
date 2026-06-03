import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// The store router derives the user id from the Clerk session via getAuth().
// For the integration test we replace getAuth with a stub that reads the user
// id from a test-only header, so we can exercise the REAL router + REAL Postgres
// per-account isolation, import gate and upsert logic without a live Clerk
// session. Everything else (the DB queries in store.ts) is unmocked.
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import storeRouter from "../src/routes/store";
import { db, userEntities, userProfiles } from "@workspace/db";
import { like } from "drizzle-orm";

// All test users share a unique-per-run prefix so cleanup can target only this
// run's rows and concurrent runs never collide.
const PREFIX = `itest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "16mb" }));
  app.use("/store", storeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  // Remove only the rows this run created.
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await db.delete(userProfiles).where(like(userProfiles.userId, `${PREFIX}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Json = Record<string, unknown>;

async function call(
  userId: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/store${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

describe("store auth", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await call(null, "GET", "/Character");
    expect(res.status).toBe(401);
  });
});

describe("progress persists per account (account A)", () => {
  const A = user("A_persist");

  it("a created custom character survives a 'reload' (fresh request)", async () => {
    const created = await call(A, "POST", "/Character", {
      name: "Custom Hero A",
      universe: "Original",
    });
    expect(created.status).toBe(201);
    expect(created.json.id).toBeTruthy();
    expect(created.json.name).toBe("Custom Hero A");

    // Simulate a reload: a brand new request reading from the server.
    const list = await call(A, "GET", "/Character");
    expect(list.status).toBe(200);
    const names = (list.json as Json[]).map((c) => c.name);
    expect(names).toContain("Custom Hero A");

    // And it is fetchable by id.
    const one = await call(A, "GET", `/Character/${created.json.id}`);
    expect(one.json?.name).toBe("Custom Hero A");
  });
});

describe("per-account isolation (account B never sees account A's data)", () => {
  const A = user("A_iso");
  const B = user("B_iso");
  const seedIds = ["seed_x", "seed_y", "seed_z"];

  it("each account only sees its own records", async () => {
    // Account A creates custom data.
    await call(A, "POST", "/Character", { name: "A Secret", universe: "A" });

    // Account B seeds its own starter roster (deterministic seed ids).
    for (const id of seedIds) {
      await call(B, "PUT", `/Character/${id}`, {
        name: id,
        universe: "Starter",
      });
    }

    const aList = (await call(A, "GET", "/Character")).json as Json[];
    const bList = (await call(B, "GET", "/Character")).json as Json[];

    const aNames = aList.map((c) => c.name);
    const bNames = bList.map((c) => c.name);

    // A sees its own custom char and NONE of B's seeds.
    expect(aNames).toContain("A Secret");
    for (const id of seedIds) expect(aNames).not.toContain(id);

    // B sees its starter roster and NOT A's custom char.
    expect(bNames).not.toContain("A Secret");
    for (const id of seedIds) expect(bNames).toContain(id);

    // Cross-account get-by-id is impossible: B cannot read A's record.
    const aChar = aList.find((c) => c.name === "A Secret")!;
    const leaked = await call(B, "GET", `/Character/${aChar.id}`);
    expect(leaked.json).toBeNull();
  });
});

describe("one-time migration import gate", () => {
  it("imports into an empty account exactly once and refuses to run again", async () => {
    const U = user("import_once");
    const payload = {
      entities: {
        Character: [
          { id: "mig_1", name: "Migrated One" },
          { id: "mig_2", name: "Migrated Two" },
        ],
        Journal: [{ id: "j_1", title: "Old journal" }],
      },
      profile: { selected_mode: "story", display_name: "Legacy Name" },
    };

    const first = await call(U, "POST", "/import", payload);
    expect(first.status).toBe(200);
    expect(first.json.imported).toBe(true);
    expect(first.json.count).toBe(3);

    // Second import must be refused because the account now has data.
    const second = await call(U, "POST", "/import", payload);
    expect(second.json.imported).toBe(false);
    expect(second.json.reason).toBe("account_not_empty");

    // Records are present and not duplicated.
    const chars = (await call(U, "GET", "/Character")).json as Json[];
    expect(chars).toHaveLength(2);

    // Profile migrated.
    const profile = (await call(U, "GET", "/profile")).json as Json;
    expect(profile.selected_mode).toBe("story");
  });

  it("preserves a pre-existing profile field over the imported legacy profile", async () => {
    const U = user("import_profile_merge");
    // Sign-in writes a display_name BEFORE the migration runs.
    await call(U, "PUT", "/profile", { display_name: "Clerk Name" });

    await call(U, "POST", "/import", {
      entities: { Character: [{ id: "c1", name: "C1" }] },
      profile: { display_name: "Legacy Name", selected_mode: "companion" },
    });

    const profile = (await call(U, "GET", "/profile")).json as Json;
    // Server-set display_name wins; other legacy fields still merge in.
    expect(profile.display_name).toBe("Clerk Name");
    expect(profile.selected_mode).toBe("companion");
  });

  it("does not duplicate records under concurrent imports (id-bearing records)", async () => {
    const U = user("import_concurrent");
    const payload = {
      entities: {
        Character: [
          { id: "k1", name: "K1" },
          { id: "k2", name: "K2" },
          { id: "k3", name: "K3" },
        ],
      },
    };

    // Two bootstrap calls racing on first sign-in. Even if both pass the empty
    // gate, the records carry stable ids so upserts converge on the same rows.
    await Promise.all([
      call(U, "POST", "/import", payload),
      call(U, "POST", "/import", payload),
    ]);

    const chars = (await call(U, "GET", "/Character")).json as Json[];
    expect(chars).toHaveLength(3);
  });
});

describe("restore into a non-empty account (merge vs replace)", () => {
  it("merge upserts the backup over existing data and keeps untouched records", async () => {
    const U = user("restore_merge");
    // Existing data the user already has on the server.
    await call(U, "PUT", "/Character/keep_1", { id: "keep_1", name: "Keep Me" });
    await call(U, "PUT", "/Character/edit_1", { id: "edit_1", name: "Old Name" });
    await call(U, "PUT", "/profile", { display_name: "Current Name", theme: "dark" });

    const backup = {
      entities: {
        // Overwrites edit_1, adds new_1; never mentions keep_1.
        Character: [
          { id: "edit_1", name: "New Name" },
          { id: "new_1", name: "Fresh One" },
        ],
        Journal: [{ id: "jb_1", title: "Backup journal" }],
      },
      profile: { display_name: "Backup Name", mood: "calm" },
      mode: "merge",
    };

    const res = await call(U, "POST", "/restore", backup);
    expect(res.status).toBe(200);
    expect(res.json.restored).toBe(true);
    expect(res.json.mode).toBe("merge");
    expect(res.json.count).toBe(3);

    const chars = (await call(U, "GET", "/Character")).json as Json[];
    const byId = new Map(chars.map((c) => [c.id, c]));
    // Untouched record survives.
    expect(byId.get("keep_1")?.name).toBe("Keep Me");
    // Backup record overwrites the existing one.
    expect(byId.get("edit_1")?.name).toBe("New Name");
    // New record added.
    expect(byId.get("new_1")?.name).toBe("Fresh One");

    const journals = (await call(U, "GET", "/Journal")).json as Json[];
    expect(journals.map((j) => j.id)).toContain("jb_1");

    // Profile: backup values win, existing-only keys kept.
    const profile = (await call(U, "GET", "/profile")).json as Json;
    expect(profile.display_name).toBe("Backup Name");
    expect(profile.mood).toBe("calm");
    expect(profile.theme).toBe("dark");
  });

  it("replace wipes all existing data first, then restores the backup", async () => {
    const U = user("restore_replace");
    await call(U, "PUT", "/Character/old_1", { id: "old_1", name: "Doomed" });
    await call(U, "PUT", "/Quest/oldq_1", { id: "oldq_1", title: "Doomed Quest" });
    await call(U, "PUT", "/profile", { display_name: "Old", theme: "dark" });

    const backup = {
      entities: { Character: [{ id: "r_1", name: "Restored Hero" }] },
      profile: { display_name: "Restored" },
      mode: "replace",
    };

    const res = await call(U, "POST", "/restore", backup);
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe("replace");
    expect(res.json.count).toBe(1);

    // Old entities are gone entirely.
    const chars = (await call(U, "GET", "/Character")).json as Json[];
    expect(chars.map((c) => c.id)).toEqual(["r_1"]);
    const quests = (await call(U, "GET", "/Quest")).json as Json[];
    expect(quests).toHaveLength(0);

    // Profile overwritten outright (no leftover keys from the old profile).
    const profile = (await call(U, "GET", "/profile")).json as Json;
    expect(profile.display_name).toBe("Restored");
    expect(profile.theme).toBeUndefined();
  });

  it("defaults to merge when no mode is supplied", async () => {
    const U = user("restore_default");
    await call(U, "PUT", "/Character/d_keep", { id: "d_keep", name: "Survivor" });
    const res = await call(U, "POST", "/restore", {
      entities: { Character: [{ id: "d_new", name: "Added" }] },
    });
    expect(res.json.mode).toBe("merge");
    const chars = (await call(U, "GET", "/Character")).json as Json[];
    expect(new Set(chars.map((c) => c.id))).toEqual(new Set(["d_keep", "d_new"]));
  });

  it("rejects a body without an entities object", async () => {
    const U = user("restore_bad");
    const res = await call(U, "POST", "/restore", { mode: "merge" });
    expect(res.status).toBe(400);
  });
});

describe("list query is pushed into SQL with identical semantics", () => {
  // Seed a mixed dataset for one account, then exercise filter/sort/limit and
  // assert the server returns exactly what the old in-memory applyQuery did.
  const U = user("query_pushdown");

  beforeAll(async () => {
    // `rank` is a non-auto field present on only some rows, used to verify that
    // missing values sort last. (created_date can't test that — the create
    // route auto-populates it.)
    const rows: Record<string, unknown>[] = [
      { id: "n1", session_id: "s1", is_active: true, created_date: "2026-01-01", rank: "b" },
      { id: "n2", session_id: "s1", is_active: false, created_date: "2026-03-01", rank: "a" },
      { id: "n3", session_id: "s2", is_active: true, created_date: "2026-02-01", rank: "c" },
      { id: "n4", session_id: "s2", is_active: true, created_date: "2026-04-01" },
    ];
    for (const r of rows) {
      await call(U, "PUT", `/Note/${r.id}`, r);
    }
    // A second entity to exercise numeric sort (e.g. Storypoint "order").
    for (const p of [
      { id: "p1", order: 2 },
      { id: "p10", order: 10 },
      { id: "p9", order: 9 },
    ]) {
      await call(U, "PUT", `/Storypoint/${p.id}`, p);
    }
  });

  const ids = (rows: Json[]) => rows.map((r) => r.id);

  it("equality filter on a string field runs in the DB", async () => {
    const q = encodeURIComponent(JSON.stringify({ session_id: "s1" }));
    const res = await call(U, "GET", `/Note?filters=${q}`);
    expect(res.status).toBe(200);
    expect(new Set(ids(res.json))).toEqual(new Set(["n1", "n2"]));
  });

  it("equality filter is type-faithful (boolean true, not the string)", async () => {
    const q = encodeURIComponent(JSON.stringify({ is_active: true }));
    const res = await call(U, "GET", `/Note?filters=${q}`);
    expect(new Set(ids(res.json))).toEqual(new Set(["n1", "n3", "n4"]));

    // A string "true" must NOT match a stored boolean true (=== semantics).
    const qStr = encodeURIComponent(JSON.stringify({ is_active: "true" }));
    const resStr = await call(U, "GET", `/Note?filters=${qStr}`);
    expect(resStr.json).toHaveLength(0);
  });

  it("combines two equality filters (AND)", async () => {
    const q = encodeURIComponent(
      JSON.stringify({ session_id: "s2", is_active: true }),
    );
    const res = await call(U, "GET", `/Note?filters=${q}`);
    expect(new Set(ids(res.json))).toEqual(new Set(["n3", "n4"]));
  });

  it("descending string sort orders lexically", async () => {
    const res = await call(U, "GET", `/Note?sort=${encodeURIComponent("-created_date")}`);
    // n4 (Apr) > n2 (Mar) > n3 (Feb) > n1 (Jan).
    expect(ids(res.json)).toEqual(["n4", "n2", "n3", "n1"]);
  });

  it("missing values sort last regardless of direction", async () => {
    // rank is present on n1/n2/n3 only; n4 has none and must come last both ways.
    const asc = await call(U, "GET", `/Note?sort=rank`);
    expect(ids(asc.json)).toEqual(["n2", "n1", "n3", "n4"]);
    const desc = await call(U, "GET", `/Note?sort=${encodeURIComponent("-rank")}`);
    expect(ids(desc.json)).toEqual(["n3", "n1", "n2", "n4"]);
  });

  it("mixed number/string column matches the old per-pair comparator", async () => {
    // A field holding both numbers and strings: the legacy JS comparator used
    // numeric compare ONLY between two numbers and String() compare otherwise,
    // which is type-dependent per pair and can't be a single ORDER BY. The
    // server must fall back to that exact comparator.
    for (const m of [
      { id: "m1", val: 2 }, // number
      { id: "m2", val: "10" }, // string
      { id: "m3", val: 9 }, // number
      { id: "m4", val: "3" }, // string
    ]) {
      await call(U, "PUT", `/Mixed/${m.id}`, m);
    }
    // Legacy comparator asc: "10" < 2 < "3" < 9  (String("2") > "10", 2 < 9
    // numerically, "2" < "3", "9" > "3" as strings).
    const asc = await call(U, "GET", `/Mixed?sort=val`);
    expect(ids(asc.json)).toEqual(["m2", "m1", "m4", "m3"]);
    const desc = await call(U, "GET", `/Mixed?sort=${encodeURIComponent("-val")}`);
    expect(ids(desc.json)).toEqual(["m3", "m4", "m1", "m2"]);
  });

  it("numeric sort compares as numbers, not strings", async () => {
    const res = await call(U, "GET", `/Storypoint?sort=order`);
    // Numeric: 2 < 9 < 10 (string sort would give 10 < 2 < 9).
    expect(ids(res.json)).toEqual(["p1", "p9", "p10"]);
    const desc = await call(U, "GET", `/Storypoint?sort=${encodeURIComponent("-order")}`);
    expect(ids(desc.json)).toEqual(["p10", "p9", "p1"]);
  });

  it("limit is applied in the DB after sort", async () => {
    const res = await call(U, "GET", `/Note?sort=${encodeURIComponent("-created_date")}&limit=2`);
    expect(ids(res.json)).toEqual(["n4", "n2"]);
  });

  it("filter + sort + limit compose", async () => {
    const q = encodeURIComponent(JSON.stringify({ session_id: "s1" }));
    const res = await call(
      U,
      "GET",
      `/Note?filters=${q}&sort=${encodeURIComponent("-created_date")}&limit=1`,
    );
    expect(ids(res.json)).toEqual(["n2"]);
  });
});

describe("concurrent seeding does not duplicate the starter roster", () => {
  it("two sessions seeding the same fresh account converge on one roster", async () => {
    const U = user("seed_concurrent");
    // Deterministic seed ids (mirrors seedCharacters.seedId()).
    const roster = Array.from({ length: 8 }, (_, i) => ({
      id: `seed_char_${i}`,
      name: `Seed ${i}`,
      universe: "Starter",
    }));

    const seedOnce = () =>
      Promise.all(
        roster.map((c) => call(U, "PUT", `/Character/${c.id}`, c)),
      );

    // Two concurrent sessions both observe an empty roster and both seed.
    await Promise.all([seedOnce(), seedOnce()]);

    const chars = (await call(U, "GET", "/Character")).json as Json[];
    // Upsert-by-id means the roster is seeded once, not doubled.
    expect(chars).toHaveLength(roster.length);
  });
});
