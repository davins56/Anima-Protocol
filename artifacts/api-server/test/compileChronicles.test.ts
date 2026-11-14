/**
 * CharacterJournal compile: incremental since last run, deduped message ids,
 * same-day update of one entry per character. Uses the disposable test schema.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  db,
  ensureSchemaOnce,
  userEntities,
  userProfiles,
} from "@workspace/db";
import {
  CHARACTER_ENTITY,
  CHARACTER_JOURNAL,
  CHRONICLES_CRON,
  DEFAULT_CHRONICLE_TIMEZONE,
  chronicleDateFor,
  compileChroniclesForUser,
  extractiveChronicleDraft,
  loadChronicleTimeZone,
  resolveChronicleTimeZone,
  runChroniclesCycle,
  type ChronicleGenerateInput,
} from "../src/lib/chronicles/compileChronicles";

const PREFIX = `chr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const owner = `${PREFIX}owner`;
const other = `${PREFIX}other`;
const asami = `${PREFIX}asami`;
const korra = `${PREFIX}korra`;
const otherChar = `${PREFIX}other_char`;
const sessionA = `${PREFIX}sess_a`;
const sessionB = `${PREFIX}sess_b`;
const sessionOther = `${PREFIX}sess_o`;

const NOW = new Date("2026-11-13T22:00:00.000Z"); // 5pm America/New_York
const TZ = "America/New_York";
const TODAY = chronicleDateFor(NOW, TZ); // 2026-11-13
const YESTERDAY = "2026-11-12";

function msg(partial: Record<string, unknown>) {
  const id = String(partial.id);
  return {
    userId: owner,
    entityName: CHAT_MESSAGE,
    entityId: id,
    data: {
      id,
      session_id: sessionA,
      role: "user",
      content: "hello",
      created_date: "2026-11-13T18:00:00.000Z",
      ...partial,
    },
    createdAt: new Date(String((partial.created_date as string | undefined) ?? "2026-11-13T18:00:00.000Z")),
    updatedAt: new Date(String((partial.created_date as string | undefined) ?? "2026-11-13T18:00:00.000Z")),
  };
}

async function journals(userId = owner) {
  const rows = await db
    .select()
    .from(userEntities)
    .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHARACTER_JOURNAL)));
  return rows.map((row) => ({
    entityId: row.entityId,
    data: row.data as Record<string, unknown>,
  }));
}

async function seed() {
  await db.insert(userEntities).values([
    {
      userId: owner,
      entityName: CHARACTER_ENTITY,
      entityId: asami,
      data: { id: asami, name: "Asami Sato" },
    },
    {
      userId: owner,
      entityName: CHARACTER_ENTITY,
      entityId: korra,
      data: { id: korra, name: "Korra" },
    },
    {
      userId: other,
      entityName: CHARACTER_ENTITY,
      entityId: otherChar,
      data: { id: otherChar, name: "Other" },
    },
    {
      userId: owner,
      entityName: CHAT_SESSION,
      entityId: sessionA,
      data: { id: sessionA, title: "Talk with Asami", character_id: asami, mode: "solo" },
    },
    {
      userId: owner,
      entityName: CHAT_SESSION,
      entityId: sessionB,
      data: { id: sessionB, title: "Talk with Korra", character_id: korra, mode: "solo" },
    },
    {
      userId: other,
      entityName: CHAT_SESSION,
      entityId: sessionOther,
      data: { id: sessionOther, title: "Other chat", character_id: otherChar, mode: "solo" },
    },
    msg({
      id: `${PREFIX}m1`,
      role: "user",
      content: "Asami, tell me about the factory.",
      created_date: "2026-11-13T16:00:00.000Z",
    }),
    msg({
      id: `${PREFIX}m2`,
      role: "assistant",
      content: "It was loud today, but I kept thinking about our evening plans.",
      character_id: asami,
      character_name: "Asami Sato",
      created_date: "2026-11-13T16:01:00.000Z",
    }),
    msg({
      id: `${PREFIX}m3`,
      role: "user",
      content: "I missed you.",
      created_date: "2026-11-13T16:02:00.000Z",
    }),
    msg({
      id: `${PREFIX}k1`,
      session_id: sessionB,
      role: "user",
      content: "Ready to train?",
      created_date: "2026-11-13T17:00:00.000Z",
    }),
    msg({
      id: `${PREFIX}k2`,
      session_id: sessionB,
      role: "assistant",
      character_id: korra,
      character_name: "Korra",
      content: "Always. Meet me at the gym.",
      created_date: "2026-11-13T17:01:00.000Z",
    }),
    {
      userId: other,
      entityName: CHAT_MESSAGE,
      entityId: `${PREFIX}o1`,
      data: {
        id: `${PREFIX}o1`,
        session_id: sessionOther,
        role: "user",
        content: "secret other-user chat",
        created_date: "2026-11-13T16:30:00.000Z",
      },
      createdAt: new Date("2026-11-13T16:30:00.000Z"),
      updatedAt: new Date("2026-11-13T16:30:00.000Z"),
    },
  ]);
}

beforeAll(async () => {
  await ensureSchemaOnce();
  await seed();
});

afterAll(async () => {
  await db.delete(userEntities).where(eq(userEntities.userId, owner));
  await db.delete(userEntities).where(eq(userEntities.userId, other));
  await db.delete(userProfiles).where(eq(userProfiles.userId, owner));
  await db.delete(userProfiles).where(eq(userProfiles.userId, other));
});

describe("compileChroniclesForUser", () => {
  it("writes one journal per character for today's chats and ignores other users", async () => {
    const seen: ChronicleGenerateInput[] = [];
    const stats = await compileChroniclesForUser(owner, {
      now: NOW,
      timeZone: TZ,
      generate: async (input) => {
        seen.push(input);
        return {
          title: `${input.character_name} on ${input.chronicle_date}`,
          content: `Diary for ${input.messages.length} messages.`,
          character_insights: "They were present.",
          key_moments: input.messages.slice(-2).map((m) => m.content),
          emotional_tone: "hopeful",
        };
      },
    });

    expect(stats.compiled).toBe(2);
    expect(stats.updated).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(seen.map((s) => s.character_name).sort()).toEqual(["Asami Sato", "Korra"]);
    expect(seen.every((s) => s.chronicle_date === TODAY)).toBe(true);
    expect(seen.some((s) => s.messages.some((m) => m.content.includes("secret other-user")))).toBe(
      false,
    );

    const rows = await journals(owner);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.data.chronicle_date === TODAY)).toBe(true);
    const asamiRow = rows.find((r) => r.data.character_id === asami)!;
    expect(asamiRow.data.title).toBe("Asami Sato on 2026-11-13");
    expect(asamiRow.data.emotional_tone).toBe("hopeful");
    const sourceIds = asamiRow.data.source_message_ids as string[];
    expect(sourceIds.sort()).toEqual([`${PREFIX}m1`, `${PREFIX}m2`, `${PREFIX}m3`].sort());

    const otherRows = await journals(other);
    expect(otherRows).toHaveLength(0);
  });

  it("skips a second compile when no new messages arrived (dedupe)", async () => {
    let calls = 0;
    const stats = await compileChroniclesForUser(owner, {
      now: NOW,
      timeZone: TZ,
      generate: async (input) => {
        calls += 1;
        return extractiveChronicleDraft(input);
      },
    });
    expect(stats.compiled).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.skipped).toBe(2);
    expect(calls).toBe(0);
    expect(await journals(owner)).toHaveLength(2);
  });

  it("updates the same day's entry when new messages arrive, without inserting another row", async () => {
    await db.insert(userEntities).values([
      msg({
        id: `${PREFIX}m4`,
        role: "user",
        content: "Let's go to the races tonight.",
        created_date: "2026-11-13T20:00:00.000Z",
      }),
      msg({
        id: `${PREFIX}m5`,
        role: "assistant",
        character_id: asami,
        character_name: "Asami Sato",
        content: "I'll bring the roadster.",
        created_date: "2026-11-13T20:01:00.000Z",
      }),
    ]);

    const before = (await journals(owner)).find((r) => r.data.character_id === asami)!;

    let generateInput: ChronicleGenerateInput | undefined;
    const stats = await compileChroniclesForUser(owner, {
      now: NOW,
      timeZone: TZ,
      generate: async (input) => {
        generateInput = input;
        return {
          title: "Evening plans",
          content: "We decided to go to the races.",
          character_insights: "The day grew lighter.",
          key_moments: ["Let's go to the races tonight."],
          emotional_tone: "hopeful",
        };
      },
    });

    expect(stats.compiled).toBe(0);
    expect(stats.updated).toBe(1);
    expect(stats.skipped).toBe(1); // Korra unchanged
    expect(generateInput?.character_id).toBe(asami);
    expect(generateInput?.previous?.title).toBe("Asami Sato on 2026-11-13");
    expect(generateInput?.messages.some((m) => m.id === `${PREFIX}m4`)).toBe(true);
    // Whole day is passed so the revision can keep earlier moments.
    expect(generateInput?.messages.some((m) => m.id === `${PREFIX}m1`)).toBe(true);

    const after = await journals(owner);
    expect(after).toHaveLength(2);
    const asamiRow = after.find((r) => r.data.character_id === asami)!;
    expect(asamiRow.entityId).toBe(before.entityId);
    expect(asamiRow.data.title).toBe("Evening plans");
    expect(asamiRow.data.content).toBe("We decided to go to the races.");
    const sourceIds = asamiRow.data.source_message_ids as string[];
    expect(sourceIds).toEqual(
      expect.arrayContaining([`${PREFIX}m1`, `${PREFIX}m2`, `${PREFIX}m3`, `${PREFIX}m4`, `${PREFIX}m5`]),
    );
    expect(asamiRow.data.chronicle_date).toBe(TODAY);
  });

  it("creates a new entry on a later day instead of overwriting yesterday", async () => {
    const nextMorning = new Date("2026-11-14T15:00:00.000Z"); // 10am ET on the 14th
    await db.insert(userEntities).values([
      msg({
        id: `${PREFIX}m6`,
        role: "user",
        content: "Good morning.",
        created_date: "2026-11-14T14:00:00.000Z",
      }),
      msg({
        id: `${PREFIX}m7`,
        role: "assistant",
        character_id: asami,
        character_name: "Asami Sato",
        content: "Coffee is on.",
        created_date: "2026-11-14T14:01:00.000Z",
      }),
    ]);

    const stats = await compileChroniclesForUser(owner, {
      now: nextMorning,
      timeZone: TZ,
      generate: async () => ({
        title: "Morning",
        content: "A quiet start.",
        character_insights: "",
        key_moments: ["Coffee is on."],
        emotional_tone: "peaceful",
      }),
    });

    expect(stats.compiled).toBe(1);
    // Yesterday's Asami and Korra entries have no new messages in-range that
    // aren't already chronicled, so they are skipped if still in the lookback.
    expect(stats.updated).toBe(0);
    expect(stats.skipped).toBeGreaterThanOrEqual(1);

    const rows = await journals(owner);
    const asamiRows = rows.filter((r) => r.data.character_id === asami);
    expect(asamiRows).toHaveLength(2);
    const days = asamiRows.map((r) => r.data.chronicle_date).sort();
    expect(days).toEqual([TODAY, "2026-11-14"]);
    const todayRow = asamiRows.find((r) => r.data.chronicle_date === TODAY)!;
    expect(todayRow.data.title).toBe("Evening plans");
    const tomorrowRow = asamiRows.find((r) => r.data.chronicle_date === "2026-11-14")!;
    expect(tomorrowRow.data.title).toBe("Morning");
    expect(tomorrowRow.entityId).not.toBe(todayRow.entityId);
  });

  it("runChroniclesCycle compiles only users with recent messages", async () => {
    const freshUser = `${PREFIX}cycle`;
    const freshChar = `${PREFIX}cycle_char`;
    const freshSess = `${PREFIX}cycle_sess`;
    await db.insert(userEntities).values([
      {
        userId: freshUser,
        entityName: CHARACTER_ENTITY,
        entityId: freshChar,
        data: { id: freshChar, name: "Cycle" },
      },
      {
        userId: freshUser,
        entityName: CHAT_SESSION,
        entityId: freshSess,
        data: { id: freshSess, title: "Cycle chat", character_id: freshChar },
      },
      {
        userId: freshUser,
        entityName: CHAT_MESSAGE,
        entityId: `${PREFIX}cycle_m1`,
        data: {
          id: `${PREFIX}cycle_m1`,
          session_id: freshSess,
          role: "user",
          content: "just now",
          created_date: "2026-11-13T21:00:00.000Z",
        },
        createdAt: new Date("2026-11-13T21:00:00.000Z"),
        updatedAt: new Date("2026-11-13T21:00:00.000Z"),
      },
    ]);

    const cycle = await runChroniclesCycle({
      now: NOW,
      timeZone: TZ,
      generate: async (input) => ({
        title: `Cycle ${input.character_name}`,
        content: "From the cron.",
        character_insights: "",
        key_moments: [],
        emotional_tone: "reflective",
      }),
    });

    expect(cycle.users).toBeGreaterThanOrEqual(1);
    const freshRows = await journals(freshUser);
    expect(freshRows).toHaveLength(1);
    expect(freshRows[0].data.content).toBe("From the cron.");

    await db.delete(userEntities).where(eq(userEntities.userId, freshUser));
  });
});

describe("chronicle date helpers and wiring", () => {
  it("uses the user's timezone for the calendar day", () => {
    // 2026-11-13 22:00 UTC is still the 13th in New York, but...
    expect(chronicleDateFor(new Date("2026-11-14T03:30:00.000Z"), TZ)).toBe("2026-11-13");
    expect(chronicleDateFor(new Date("2026-11-14T03:30:00.000Z"), "UTC")).toBe("2026-11-14");
    expect(TODAY).toBe(YESTERDAY === "2026-11-12" ? "2026-11-13" : TODAY);
  });

  it("keeps 8 PM Eastern on that Eastern calendar day by default", () => {
    // 8:00 PM EST on 13 Nov 2026 is 01:00 UTC on the 14th. UTC would roll
    // over; America/New_York, the fallback, must not.
    const eightPmEt = new Date("2026-11-14T01:00:00.000Z");
    expect(chronicleDateFor(eightPmEt, "America/New_York")).toBe("2026-11-13");
    expect(chronicleDateFor(eightPmEt)).toBe("2026-11-13");
    expect(DEFAULT_CHRONICLE_TIMEZONE).toBe("America/New_York");
  });

  it("registers the 3-hour cron on the Worker and in wrangler", () => {
    const w = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
    const wr = readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8");
    const fn = readFileSync(
      new URL("../src/routes/openai/functions.ts", import.meta.url),
      "utf8",
    );
    expect(CHRONICLES_CRON).toBe("15 0,3,6,9,12,15,18,21 * * *");
    expect(w).toContain(`const CHRONICLES_CRON = "${CHRONICLES_CRON}"`);
    expect(wr).toContain(`"${CHRONICLES_CRON}"`);
    // Must be its own case, not the session-summary stub that only reads
    // request-body messages and never writes CharacterJournal.
    expect(fn).toMatch(/case "compileDailyChronicles"\s*:/);
    expect(fn).toContain("compileChroniclesForUser");
  });
});

describe("resolveChronicleTimeZone", () => {
  it("falls back to America/New_York when nothing is saved", () => {
    expect(resolveChronicleTimeZone(null)).toBe("America/New_York");
    expect(resolveChronicleTimeZone({})).toBe("America/New_York");
    expect(resolveChronicleTimeZone({ settings: { user_profile: { timezone: "not-a-zone" } } })).toBe(
      "America/New_York",
    );
  });

  it("uses the rhythm/senses timezone when no profile timezone is saved", () => {
    expect(
      resolveChronicleTimeZone({
        senses: { timezone: "Asia/Tokyo" },
      }),
    ).toBe("Asia/Tokyo");
  });

  it("lets the saved profile timezone win over senses", () => {
    expect(
      resolveChronicleTimeZone({
        settings: { user_profile: { timezone: "UTC" } },
        senses: { timezone: "America/New_York" },
      }),
    ).toBe("UTC");
  });
});

describe("compileChroniclesForUser uses the resolved timezone", () => {
  const eightPmEt = "2026-11-14T01:00:00.000Z"; // 8:00 PM EST, 13 Nov 2026
  const now = new Date("2026-11-14T02:00:00.000Z"); // 9:00 PM EST, still the 13th
  const tzUsers: string[] = [];

  async function seedTzUser(suffix: string, profile?: Record<string, unknown>) {
    const userId = `${PREFIX}tz_${suffix}`;
    const characterId = `${userId}_char`;
    const sessionId = `${userId}_sess`;
    const messageId = `${userId}_msg`;
    tzUsers.push(userId);
    await db.insert(userEntities).values([
      {
        userId,
        entityName: CHARACTER_ENTITY,
        entityId: characterId,
        data: { id: characterId, name: "Asami Sato" },
      },
      {
        userId,
        entityName: CHAT_SESSION,
        entityId: sessionId,
        data: { id: sessionId, title: "Evening chat", character_id: characterId, mode: "solo" },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: messageId,
        data: {
          id: messageId,
          session_id: sessionId,
          role: "user",
          content: "It's eight in the evening here.",
          created_date: eightPmEt,
        },
        createdAt: new Date(eightPmEt),
        updatedAt: new Date(eightPmEt),
      },
    ]);
    if (profile) {
      await db.insert(userProfiles).values({ userId, data: profile });
    }
    return userId;
  }

  afterAll(async () => {
    for (const userId of tzUsers) {
      await db.delete(userEntities).where(eq(userEntities.userId, userId));
      await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    }
  });

  async function compileAndDate(userId: string) {
    const stats = await compileChroniclesForUser(userId, {
      now,
      generate: async (input) => ({
        title: `Day ${input.chronicle_date}`,
        content: "Evening notes.",
        character_insights: "",
        key_moments: [],
        emotional_tone: "peaceful",
      }),
    });
    const rows = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHARACTER_JOURNAL)));
    return {
      stats,
      date: (rows[0]?.data as Record<string, unknown> | undefined)?.chronicle_date,
    };
  }

  it("keeps an 8 PM ET chat on that ET day when no timezone is saved", async () => {
    const userId = await seedTzUser("fallback");
    expect(await loadChronicleTimeZone(userId)).toBe("America/New_York");
    const result = await compileAndDate(userId);
    expect(result.stats.compiled).toBe(1);
    expect(result.date).toBe("2026-11-13");
  });

  it("uses the senses/rhythm timezone when no profile timezone is saved", async () => {
    const userId = await seedTzUser("senses", { senses: { timezone: "Asia/Tokyo" } });
    expect(await loadChronicleTimeZone(userId)).toBe("Asia/Tokyo");
    const result = await compileAndDate(userId);
    expect(result.stats.compiled).toBe(1);
    expect(result.date).toBe("2026-11-14");
  });

  it("lets the saved timezone win over senses and the fallback", async () => {
    const userId = await seedTzUser("saved", {
      settings: { user_profile: { timezone: "UTC" } },
      senses: { timezone: "America/New_York" },
    });
    expect(await loadChronicleTimeZone(userId)).toBe("UTC");
    const result = await compileAndDate(userId);
    expect(result.stats.compiled).toBe(1);
    expect(result.date).toBe("2026-11-14");
  });
});
