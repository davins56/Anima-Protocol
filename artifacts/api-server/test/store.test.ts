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

describe("export + restore round trip (the backup safety net)", () => {
  // The export endpoint is the only safety net before irreversible Factory
  // Reset / Delete Account, and its JSON shape must keep round-tripping through
  // /import and /restore. These tests seed real data, export it, then prove the
  // exact export output restores every entity type and the profile into a fresh
  // account.
  it("export contains every entity type and the profile for the account", async () => {
    const U = user("export_full");
    // Seed several distinct entity types plus some multi-record types.
    await call(U, "PUT", "/Character/ec_1", { id: "ec_1", name: "Hero", universe: "Original" });
    await call(U, "PUT", "/Character/ec_2", { id: "ec_2", name: "Sidekick", universe: "Original" });
    await call(U, "PUT", "/Journal/ej_1", { id: "ej_1", title: "Day one" });
    await call(U, "PUT", "/Quest/eq_1", { id: "eq_1", title: "Find the relic" });
    await call(U, "PUT", "/profile", { display_name: "Backup Owner", selected_mode: "story" });

    const res = await call(U, "GET", "/export");
    expect(res.status).toBe(200);
    expect(res.json.version).toBe(1);
    expect(typeof res.json.exported_at).toBe("string");

    const entities = res.json.entities as Record<string, Json[]>;
    // Every seeded entity type is present.
    expect(Object.keys(entities).sort()).toEqual(["Character", "Journal", "Quest"]);
    expect(new Set((entities.Character).map((c) => c.id))).toEqual(
      new Set(["ec_1", "ec_2"]),
    );
    expect((entities.Journal).map((j) => j.id)).toEqual(["ej_1"]);
    expect((entities.Quest).map((q) => q.id)).toEqual(["eq_1"]);

    // The profile rides along with the export.
    const profile = res.json.profile as Json;
    expect(profile.display_name).toBe("Backup Owner");
    expect(profile.selected_mode).toBe("story");
  });

  it("an exported backup imports cleanly into a fresh account (records + profile)", async () => {
    const SRC = user("rt_import_src");
    const DST = user("rt_import_dst");

    // Build a realistic account on the source.
    await call(SRC, "PUT", "/Character/c_a", { id: "c_a", name: "Aria", universe: "Origin" });
    await call(SRC, "PUT", "/Character/c_b", { id: "c_b", name: "Bryn", universe: "Origin" });
    await call(SRC, "PUT", "/Journal/jr_1", { id: "jr_1", title: "Entry" });
    await call(SRC, "PUT", "/profile", { display_name: "Owner", theme: "dark" });

    // Export it verbatim, then import the SAME payload into an empty account.
    const exported = (await call(SRC, "GET", "/export")).json;
    const imp = await call(DST, "POST", "/import", {
      entities: exported.entities,
      profile: exported.profile,
    });
    expect(imp.status).toBe(200);
    expect(imp.json.imported).toBe(true);
    expect(imp.json.count).toBe(3);

    // Every record came back on the destination.
    const chars = (await call(DST, "GET", "/Character")).json as Json[];
    expect(new Set(chars.map((c) => c.id))).toEqual(new Set(["c_a", "c_b"]));
    const journals = (await call(DST, "GET", "/Journal")).json as Json[];
    expect(journals.map((j) => j.id)).toEqual(["jr_1"]);

    // The profile came back too.
    const profile = (await call(DST, "GET", "/profile")).json as Json;
    expect(profile.display_name).toBe("Owner");
    expect(profile.theme).toBe("dark");
  });

  it("an exported backup restores (replace) into a fresh account verbatim", async () => {
    const SRC = user("rt_restore_src");
    const DST = user("rt_restore_dst");

    await call(SRC, "PUT", "/Character/s_1", { id: "s_1", name: "Solo", universe: "U" });
    await call(SRC, "PUT", "/Quest/sq_1", { id: "sq_1", title: "Quest" });
    await call(SRC, "PUT", "/profile", { display_name: "Restorer", mood: "calm" });

    const exported = (await call(SRC, "GET", "/export")).json;
    // Restore is the user-driven path; feed it the export output directly.
    const restored = await call(DST, "POST", "/restore", {
      entities: exported.entities,
      profile: exported.profile,
      mode: "replace",
    });
    expect(restored.status).toBe(200);
    expect(restored.json.restored).toBe(true);
    expect(restored.json.count).toBe(2);

    const chars = (await call(DST, "GET", "/Character")).json as Json[];
    expect(chars.map((c) => c.id)).toEqual(["s_1"]);
    const quests = (await call(DST, "GET", "/Quest")).json as Json[];
    expect(quests.map((q) => q.id)).toEqual(["sq_1"]);
    const profile = (await call(DST, "GET", "/profile")).json as Json;
    expect(profile.display_name).toBe("Restorer");
    expect(profile.mood).toBe("calm");
  });

  it("a full round trip preserves arbitrary record fields exactly", async () => {
    const SRC = user("rt_fidelity_src");
    const DST = user("rt_fidelity_dst");

    // A record with nested/typed fields that must survive the JSON round trip.
    const rich = {
      id: "rich_1",
      name: "Complex",
      level: 7,
      active: true,
      tags: ["a", "b"],
      meta: { origin: "test", nested: { deep: 1 } },
    };
    await call(SRC, "PUT", "/Character/rich_1", rich);

    const exported = (await call(SRC, "GET", "/export")).json;
    await call(DST, "POST", "/import", {
      entities: exported.entities,
      profile: exported.profile,
    });

    const back = (await call(DST, "GET", "/Character/rich_1")).json as Json;
    expect(back).toMatchObject(rich);
  });

  it("rejects a malformed / non-backup file gracefully", async () => {
    const U = user("rt_malformed");
    // A file that isn't an Anima backup at all (no entities object). The client
    // guards this too, but the server must reject it rather than corrupt data.
    const bad = await call(U, "POST", "/restore", { foo: "bar", mode: "merge" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/entities/i);

    // entities present but the wrong type (array, not an object map) is also bad.
    const badArray = await call(U, "POST", "/restore", { entities: [], mode: "replace" });
    expect(badArray.status).toBe(400);

    // The rejected restore left the account untouched (no rows created).
    const chars = (await call(U, "GET", "/Character")).json as Json[];
    expect(chars).toHaveLength(0);
  });
});

describe("full export -> restore round trip through merge & replace", () => {
  // The other round-trip tests cover the empty-account path (import / replace).
  // These exercise the user-driven /restore merge AND replace modes fed the
  // EXACT payload that /export emits, and assert the destination account ends
  // up byte-for-byte identical (entities + profile) — catching any shape drift
  // between what /export writes and what /restore can read back. Each mode is
  // round-tripped into both an empty and a non-empty destination.

  // /export returns entity arrays in DB order and a fresh `exported_at` every
  // call, so normalise to compare only the durable payload: sort entity records
  // by id and drop the timestamp/version envelope.
  const snapshot = (
    exp: any,
  ): { entities: Record<string, Json[]>; profile: Json | null } => {
    const entities: Record<string, Json[]> = {};
    for (const [name, recs] of Object.entries(
      exp.entities as Record<string, Json[]>,
    )) {
      entities[name] = [...recs].sort((a, b) =>
        String(a.id).localeCompare(String(b.id)),
      );
    }
    return { entities, profile: (exp.profile as Json) ?? null };
  };

  // Build a realistic, multi-type account with nested fields on `who`, then
  // return its verbatim /export payload (the thing a user downloads as a file).
  const seedAndExport = async (who: string) => {
    await call(who, "PUT", "/Character/rt_c1", {
      id: "rt_c1",
      name: "Aria",
      universe: "Origin",
      stats: { level: 9, tags: ["lead", "mage"] },
    });
    await call(who, "PUT", "/Character/rt_c2", {
      id: "rt_c2",
      name: "Bryn",
      universe: "Origin",
    });
    await call(who, "PUT", "/Journal/rt_j1", { id: "rt_j1", title: "Entry one" });
    await call(who, "PUT", "/Quest/rt_q1", { id: "rt_q1", title: "The relic" });
    await call(who, "PUT", "/profile", {
      display_name: "Owner",
      selected_mode: "story",
      prefs: { theme: "dark", sound: true },
    });
    return (await call(who, "GET", "/export")).json;
  };

  it("merge restores a full export verbatim into an EMPTY account", async () => {
    const SRC = user("rt_merge_empty_src");
    const DST = user("rt_merge_empty_dst");

    const exported = await seedAndExport(SRC);
    const res = await call(DST, "POST", "/restore", {
      entities: exported.entities,
      profile: exported.profile,
      mode: "merge",
    });
    expect(res.status).toBe(200);
    expect(res.json.restored).toBe(true);
    expect(res.json.mode).toBe("merge");
    expect(res.json.count).toBe(4);

    // The destination's own export now matches the source's exactly.
    const dstExport = (await call(DST, "GET", "/export")).json;
    expect(snapshot(dstExport)).toEqual(snapshot(exported));
  });

  it("replace restores a full export verbatim into an EMPTY account", async () => {
    const SRC = user("rt_replace_empty_src");
    const DST = user("rt_replace_empty_dst");

    const exported = await seedAndExport(SRC);
    const res = await call(DST, "POST", "/restore", {
      entities: exported.entities,
      profile: exported.profile,
      mode: "replace",
    });
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe("replace");
    expect(res.json.count).toBe(4);

    const dstExport = (await call(DST, "GET", "/export")).json;
    expect(snapshot(dstExport)).toEqual(snapshot(exported));
  });

  it("merge of a full export keeps prior records and overlays the backup profile", async () => {
    const SRC = user("rt_merge_nonempty_src");
    const DST = user("rt_merge_nonempty_dst");

    // The destination already has its own data before the restore.
    await call(DST, "PUT", "/Character/own_1", { id: "own_1", name: "Local Hero" });
    await call(DST, "PUT", "/Note/own_n1", { id: "own_n1", body: "kept" });
    await call(DST, "PUT", "/profile", {
      display_name: "Local Name",
      onlylocal: "stays",
    });

    const exported = await seedAndExport(SRC);
    const res = await call(DST, "POST", "/restore", {
      entities: exported.entities,
      profile: exported.profile,
      mode: "merge",
    });
    expect(res.json.mode).toBe("merge");
    expect(res.json.count).toBe(4);

    // Every backup record is present, byte-for-byte.
    const chars = (await call(DST, "GET", "/Character")).json as Json[];
    const charsById = new Map(chars.map((c) => [c.id, c]));
    expect(charsById.get("rt_c1")).toEqual(
      snapshot(exported).entities.Character.find((c) => c.id === "rt_c1"),
    );
    expect(charsById.get("rt_c2")?.name).toBe("Bryn");
    // The destination's pre-existing, non-conflicting record survives.
    expect(charsById.get("own_1")?.name).toBe("Local Hero");
    const notes = (await call(DST, "GET", "/Note")).json as Json[];
    expect(notes.map((n) => n.id)).toEqual(["own_n1"]);
    const journals = (await call(DST, "GET", "/Journal")).json as Json[];
    expect(journals.map((j) => j.id)).toEqual(["rt_j1"]);

    // Profile: backup values win, destination-only keys are preserved.
    const profile = (await call(DST, "GET", "/profile")).json as Json;
    expect(profile.display_name).toBe("Owner");
    expect(profile.selected_mode).toBe("story");
    expect(profile.prefs).toEqual({ theme: "dark", sound: true });
    expect(profile.onlylocal).toBe("stays");
  });

  it("replace of a full export makes a NON-EMPTY account identical to the source", async () => {
    const SRC = user("rt_replace_nonempty_src");
    const DST = user("rt_replace_nonempty_dst");

    // Junk that must be wiped: includes an entity type the backup never mentions.
    await call(DST, "PUT", "/Character/junk_1", { id: "junk_1", name: "Doomed" });
    await call(DST, "PUT", "/Quest/junk_q", { id: "junk_q", title: "Doomed Quest" });
    await call(DST, "PUT", "/Faction/junk_f", { id: "junk_f", name: "Doomed Faction" });
    await call(DST, "PUT", "/profile", {
      display_name: "Old",
      leftover: "must vanish",
    });

    const exported = await seedAndExport(SRC);
    const res = await call(DST, "POST", "/restore", {
      entities: exported.entities,
      profile: exported.profile,
      mode: "replace",
    });
    expect(res.json.mode).toBe("replace");
    expect(res.json.count).toBe(4);

    // Whole-account snapshot is byte-for-byte identical to the source: the junk
    // entity type is gone and the profile carries no leftover keys.
    const dstExport = (await call(DST, "GET", "/export")).json;
    expect(snapshot(dstExport)).toEqual(snapshot(exported));
    const factions = (await call(DST, "GET", "/Faction")).json as Json[];
    expect(factions).toHaveLength(0);
    const profile = (await call(DST, "GET", "/profile")).json as Json;
    expect(profile.leftover).toBeUndefined();
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

  it("offset + limit page the mixed-type fallback path too", async () => {
    // Same legacy-comparator asc order: m2, m1, m4, m3. The mixed-type field
    // forces the in-memory fallback, so offset/limit must be applied there.
    const page1 = await call(U, "GET", `/Mixed?sort=val&limit=2&offset=0`);
    expect(ids(page1.json)).toEqual(["m2", "m1"]);
    const page2 = await call(U, "GET", `/Mixed?sort=val&limit=2&offset=2`);
    expect(ids(page2.json)).toEqual(["m4", "m3"]);
    const past = await call(U, "GET", `/Mixed?sort=val&limit=2&offset=4`);
    expect(past.json).toHaveLength(0);
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

  it("offset skips leading rows in the DB after sort", async () => {
    // Full desc order is n4, n2, n3, n1. Offset 1 drops n4.
    const res = await call(
      U,
      "GET",
      `/Note?sort=${encodeURIComponent("-created_date")}&offset=1`,
    );
    expect(ids(res.json)).toEqual(["n2", "n3", "n1"]);
  });

  it("limit + offset returns one page at a time (no over-fetch)", async () => {
    const sort = encodeURIComponent("-created_date");
    // Page through the 4 Notes two at a time.
    const page0 = await call(U, "GET", `/Note?sort=${sort}&limit=2&offset=0`);
    expect(ids(page0.json)).toEqual(["n4", "n2"]);
    const page1 = await call(U, "GET", `/Note?sort=${sort}&limit=2&offset=2`);
    expect(ids(page1.json)).toEqual(["n3", "n1"]);
    // Past the end yields an empty page, not an error.
    const page2 = await call(U, "GET", `/Note?sort=${sort}&limit=2&offset=4`);
    expect(page2.json).toHaveLength(0);
  });

  it("filter + sort + limit + offset compose", async () => {
    const q = encodeURIComponent(JSON.stringify({ session_id: "s2" }));
    // s2 rows desc: n4 (Apr), n3 (Feb). Offset 1, limit 1 -> just n3.
    const res = await call(
      U,
      "GET",
      `/Note?filters=${q}&sort=${encodeURIComponent("-created_date")}&limit=1&offset=1`,
    );
    expect(ids(res.json)).toEqual(["n3"]);
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

describe("chat messages stored as individual rows", () => {
  it("append assigns sequential seq and never rewrites history", async () => {
    const U = user("msg_append");
    const sid = "sess_append";

    const a = await call(U, "POST", "/messages", {
      session_id: sid,
      message: { role: "user", content: "hello" },
    });
    expect(a.status).toBe(201);
    expect(a.json.seq).toBe(0);
    expect(a.json.id).toBeTruthy();
    expect(a.json.session_id).toBe(sid);

    const b = await call(U, "POST", "/messages", {
      session_id: sid,
      message: { role: "assistant", content: "hi there" },
    });
    expect(b.json.seq).toBe(1);
    expect(b.json.id).not.toBe(a.json.id);

    const list = (await call(U, "GET", `/messages?session_id=${sid}`))
      .json as Json[];
    expect(list.map((m) => m.content)).toEqual(["hello", "hi there"]);
    expect(list.map((m) => m.seq)).toEqual([0, 1]);
  });

  it("requires session_id and message", async () => {
    const U = user("msg_validate");
    expect((await call(U, "POST", "/messages", { session_id: "s" })).status).toBe(
      400,
    );
    expect((await call(U, "GET", "/messages")).status).toBe(400);
  });

  it("paging returns the most recent N ascending, before_seq pages back", async () => {
    const U = user("msg_page");
    const sid = "sess_page";
    for (let i = 0; i < 5; i += 1) {
      await call(U, "POST", "/messages", {
        session_id: sid,
        message: { role: "user", content: `m${i}` },
      });
    }

    const recent = (
      await call(U, "GET", `/messages?session_id=${sid}&limit=2`)
    ).json as Json[];
    expect(recent.map((m) => m.content)).toEqual(["m3", "m4"]);

    const older = (
      await call(U, "GET", `/messages?session_id=${sid}&limit=2&before_seq=3`)
    ).json as Json[];
    expect(older.map((m) => m.content)).toEqual(["m1", "m2"]);
  });

  it("by-sessions batch hydrates many sessions in one call", async () => {
    const U = user("msg_batch");
    await call(U, "POST", "/messages", {
      session_id: "bs1",
      message: { content: "one" },
    });
    await call(U, "POST", "/messages", {
      session_id: "bs2",
      message: { content: "two" },
    });

    const map = (
      await call(U, "POST", "/messages/by-sessions", { ids: ["bs1", "bs2", "bs3"] })
    ).json as Record<string, Json[]>;
    expect(map.bs1.map((m) => m.content)).toEqual(["one"]);
    expect(map.bs2.map((m) => m.content)).toEqual(["two"]);
    // A session with no messages still returns an empty array.
    expect(map.bs3).toEqual([]);
  });

  it("replace reconciles by id: edits one row, trims the tail, keeps ids", async () => {
    const U = user("msg_replace");
    const sid = "sess_replace";
    const m0 = (
      await call(U, "POST", "/messages", {
        session_id: sid,
        message: { role: "user", content: "first" },
      })
    ).json;
    const m1 = (
      await call(U, "POST", "/messages", {
        session_id: sid,
        message: { role: "assistant", content: "second" },
      })
    ).json;

    // Edit the first message and drop the second (a rewind/delete via the shim).
    const replaced = (
      await call(U, "POST", "/messages/replace", {
        session_id: sid,
        messages: [{ ...m0, content: "first edited" }],
      })
    ).json as Json[];
    expect(replaced).toHaveLength(1);
    expect(replaced[0].id).toBe(m0.id);
    expect(replaced[0].content).toBe("first edited");

    const after = (await call(U, "GET", `/messages?session_id=${sid}`))
      .json as Json[];
    expect(after.map((m) => m.content)).toEqual(["first edited"]);
    expect(after.find((m) => m.id === m1.id)).toBeUndefined();
  });

  it("append after replace continues the seq from the surviving rows", async () => {
    const U = user("msg_replace_then_append");
    const sid = "sess_rta";
    const m0 = (
      await call(U, "POST", "/messages", {
        session_id: sid,
        message: { content: "a" },
      })
    ).json;
    await call(U, "POST", "/messages", {
      session_id: sid,
      message: { content: "b" },
    });
    // Trim back to just the first message.
    await call(U, "POST", "/messages/replace", {
      session_id: sid,
      messages: [m0],
    });
    const appended = (
      await call(U, "POST", "/messages", {
        session_id: sid,
        message: { content: "c" },
      })
    ).json;
    expect(appended.seq).toBe(1);
    const list = (await call(U, "GET", `/messages?session_id=${sid}`))
      .json as Json[];
    expect(list.map((m) => m.content)).toEqual(["a", "c"]);
  });

  it("migrates a legacy ChatSession.messages blob into rows on first read", async () => {
    const U = user("msg_migrate");
    const session = (
      await call(U, "POST", "/ChatSession", {
        title: "Legacy",
        messages: [
          { role: "user", content: "legacy 1" },
          { role: "assistant", content: "legacy 2" },
        ],
      })
    ).json;

    // First read migrates the blob into rows (ascending seq).
    const list = (
      await call(U, "GET", `/messages?session_id=${session.id}`)
    ).json as Json[];
    expect(list.map((m) => m.content)).toEqual(["legacy 1", "legacy 2"]);
    expect(list.map((m) => m.seq)).toEqual([0, 1]);

    // The session blob is cleared and flagged so migration is idempotent.
    const reread = (await call(U, "GET", `/ChatSession/${session.id}`)).json;
    expect(reread.messages).toEqual([]);
    expect(reread.messages_migrated).toBe(true);

    // An append lands after the migrated rows.
    const appended = (
      await call(U, "POST", "/messages", {
        session_id: session.id,
        message: { content: "new" },
      })
    ).json;
    expect(appended.seq).toBe(2);
  });

  it("concurrent appends to one session get unique, gapless seq", async () => {
    const U = user("msg_concurrent_append");
    const sid = "sess_concurrent";
    const N = 12;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        call(U, "POST", "/messages", {
          session_id: sid,
          message: { content: `c${i}` },
        }),
      ),
    );
    const list = (await call(U, "GET", `/messages?session_id=${sid}`))
      .json as Json[];
    const seqs = list.map((m) => m.seq).sort((a: any, b: any) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i));
    // No duplicate ids either.
    expect(new Set(list.map((m) => m.id)).size).toBe(N);
  });

  it("concurrent first reads migrate a blob exactly once", async () => {
    const U = user("msg_concurrent_migrate");
    const session = (
      await call(U, "POST", "/ChatSession", {
        title: "Race",
        messages: [
          { content: "x" },
          { content: "y" },
          { content: "z" },
        ],
      })
    ).json;

    // Hammer the session with parallel reads that each try to migrate.
    await Promise.all([
      call(U, "GET", `/messages?session_id=${session.id}`),
      call(U, "GET", `/messages?session_id=${session.id}`),
      call(U, "POST", "/messages/by-sessions", { ids: [session.id] }),
      call(U, "GET", `/messages?session_id=${session.id}`),
    ]);

    const list = (await call(U, "GET", `/messages?session_id=${session.id}`))
      .json as Json[];
    // Exactly the 3 original messages, not duplicated.
    expect(list.map((m) => m.content)).toEqual(["x", "y", "z"]);
    expect(list.map((m) => m.seq)).toEqual([0, 1, 2]);
  });

  it("messages are isolated per account", async () => {
    const A = user("msg_iso_a");
    const B = user("msg_iso_b");
    await call(A, "POST", "/messages", {
      session_id: "shared_sid",
      message: { content: "A secret" },
    });
    const bList = (
      await call(B, "GET", `/messages?session_id=shared_sid`)
    ).json as Json[];
    expect(bList).toEqual([]);
  });
});

// Open the SSE stream and resolve once a real (data) event arrives, or reject
// on timeout. Returns an abort() so the test can close the connection. The
// stream is read incrementally so we react to a push without waiting for close.
function openEventStream(
  userId: string,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): { gotEvent: Promise<void>; status: Promise<number>; abort: () => void } {
  const controller = new AbortController();
  let resolveStatus!: (n: number) => void;
  const status = new Promise<number>((r) => {
    resolveStatus = r;
  });
  const gotEvent = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timed out waiting for SSE event"));
    }, timeoutMs);
    (async () => {
      const res = await fetch(`${baseUrl}/store/events`, {
        headers: {
          Accept: "text/event-stream",
          ...(userId ? { "x-test-user": userId } : {}),
        },
        signal: controller.signal,
      });
      resolveStatus(res.status);
      if (!res.ok || !res.body) {
        clearTimeout(timer);
        reject(new Error(`SSE status ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.split("\n").some((l) => l.startsWith("data:"))) {
          clearTimeout(timer);
          resolve();
          controller.abort();
          return;
        }
      }
    })().catch((err) => {
      // Abort surfaces as an AbortError once we've already resolved — ignore it.
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      reject(err);
    });
  });
  return { gotEvent, status, abort: () => controller.abort() };
}

describe("live push (SSE)", () => {
  it("rejects an unauthenticated stream", async () => {
    const res = await fetch(`${baseUrl}/store/events`, {
      headers: { Accept: "text/event-stream" },
    });
    // Drain/close so the socket doesn't linger.
    await res.body?.cancel().catch(() => {});
    expect(res.status).toBe(401);
  });

  it("pushes a change event to the user's own stream after a write", async () => {
    const U = user("sse_self");
    const stream = openEventStream(U);
    // Wait for the stream's initial bytes (the ": connected" comment) to be sure
    // the client is registered before we trigger the write.
    await stream.status;
    await new Promise((r) => setTimeout(r, 100));
    await call(U, "POST", "/Character", { name: "Pushed" });
    await expect(stream.gotEvent).resolves.toBeUndefined();
    stream.abort();
  });

  it("does not push a user's write to another account's stream", async () => {
    const A = user("sse_iso_a");
    const B = user("sse_iso_b");
    const streamB = openEventStream(B, { timeoutMs: 1500 });
    await streamB.status;
    await new Promise((r) => setTimeout(r, 100));
    // A writes; B must NOT receive a push, so B's stream times out.
    await call(A, "POST", "/Character", { name: "A only" });
    await expect(streamB.gotEvent).rejects.toThrow(/timed out/);
    streamB.abort();
  });
});
