import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { getPool } from "@workspace/db";
import { buildGlb, glbBytes, PLAIN_GLB, vrmBytes } from "./glbFixture";
import { MODEL_MAX_BYTES } from "../src/lib/vessel/modelInspect";
import { MODEL_SIGNED_DOWNLOAD_TTL_S } from "../src/lib/vessel/modelStorage";

const objects = new Map<string, Uint8Array>();
const deleted: string[] = [];

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

vi.mock("../src/lib/vessel/modelStorage", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/vessel/modelStorage")>(
    "../src/lib/vessel/modelStorage",
  );
  const FIXED = "11111111-1111-4111-8111-111111111111";
  return {
    ...actual,
    hasModelStorage: () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    createSignedUploadUrl: vi.fn(async (args: { userId: string; characterId: string; ext: "vrm" | "glb" }) => {
      const path = actual.modelObjectPath(args.userId, args.characterId, args.ext, FIXED);
      return {
        bucket: "character-models",
        path,
        uploadUrl: `https://storage.test/upload/${path}`,
        token: "test-token",
        expiresIn: 600,
        maxBytes: 50 * 1024 * 1024,
        contentType: actual.contentTypeForExt(args.ext),
      };
    }),
    getObjectMetadata: vi.fn(async (path: string) => {
      const bytes = objects.get(path);
      if (!bytes) return null;
      return { byteSize: bytes.byteLength, etag: "\"test\"" };
    }),
    readObjectRange: vi.fn(async (path: string, start: number, end: number) => {
      const bytes = objects.get(path);
      if (!bytes) throw Object.assign(new Error("missing object"), { status: 404 });
      return bytes.slice(start, end + 1);
    }),
    deleteObject: vi.fn(async (path: string) => {
      deleted.push(path);
      objects.delete(path);
      return true;
    }),
    signedDownloadUrl: vi.fn(async (path: string) => `https://storage.test/download/${path}?sig=1`),
  };
});

import vesselRouter from "../src/routes/vessel";

const PREFIX = `vmdl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

let server: Server;
let baseUrl = "";
const prevEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_MODEL_BUCKET: process.env.SUPABASE_MODEL_BUCKET,
};

async function applyVesselTestSchema() {
  const pool = getPool();
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION anima_forbid_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'anima: % on % is forbidden (append-only memory table)', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_identity_core (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      character_id text NOT NULL,
      version integer NOT NULL CHECK (version >= 1),
      name text NOT NULL,
      personality_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,
      voice jsonb NOT NULL DEFAULT '{}'::jsonb,
      core_traits jsonb NOT NULL DEFAULT '[]'::jsonb,
      relationships jsonb NOT NULL DEFAULT '{}'::jsonb,
      backstory text NOT NULL DEFAULT '',
      source text NOT NULL DEFAULT 'app',
      change_note text NOT NULL DEFAULT '',
      vessel_version integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT character_identity_core_version_uq UNIQUE (user_id, character_id, version)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_event_types (
      type text PRIMARY KEY,
      description text NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`INSERT INTO memory_event_types (type, description) VALUES
    ('vessel_changed', '3D vessel customization saved')
    ON CONFLICT (type) DO NOTHING`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      character_id text NOT NULL,
      conversation_id text,
      message_id text,
      event_type text NOT NULL REFERENCES memory_event_types(type),
      content text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      emotional_weight real NOT NULL DEFAULT 0.5,
      identity_version integer,
      dedupe_key text,
      source text NOT NULL DEFAULT 'api',
      occurred_at timestamptz NOT NULL DEFAULT now(),
      inserted_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS memory_events_dedupe_uq
      ON memory_events (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_vessel (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      character_id text NOT NULL,
      version integer NOT NULL CHECK (version >= 1),
      config jsonb NOT NULL,
      snapshot_bucket text,
      snapshot_path text,
      change_note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT character_vessel_version_uq UNIQUE (user_id, character_id, version)
    )
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION save_vessel_version(
      p_user_id        text,
      p_character_id   text,
      p_name           text,
      p_config         jsonb,
      p_change_note    text DEFAULT '',
      p_snapshot_bucket text DEFAULT NULL,
      p_snapshot_path  text DEFAULT NULL
    ) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE
      v_next   integer;
      v_row    character_vessel;
      prev     character_identity_core;
      ident    character_identity_core;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_character_id, 0));
      SELECT COALESCE(max(version), 0) + 1 INTO v_next FROM character_vessel
       WHERE user_id = p_user_id AND character_id = p_character_id;
      INSERT INTO character_vessel
        (user_id, character_id, version, config, snapshot_bucket, snapshot_path, change_note)
      VALUES (p_user_id, p_character_id, v_next, p_config, p_snapshot_bucket, p_snapshot_path, COALESCE(p_change_note, ''))
      RETURNING * INTO v_row;
      SELECT * INTO prev FROM character_identity_core
       WHERE user_id = p_user_id AND character_id = p_character_id
       ORDER BY version DESC LIMIT 1;
      INSERT INTO character_identity_core
        (user_id, character_id, version, name, personality_matrix, voice, core_traits,
         relationships, backstory, source, change_note, vessel_version)
      VALUES (
        p_user_id, p_character_id, COALESCE(prev.version, 0) + 1,
        COALESCE(NULLIF(p_name, ''), prev.name, 'Unnamed'),
        COALESCE(prev.personality_matrix, '{}'::jsonb), COALESCE(prev.voice, '{}'::jsonb),
        COALESCE(prev.core_traits, '[]'::jsonb), COALESCE(prev.relationships, '{}'::jsonb),
        COALESCE(prev.backstory, ''), 'vessel',
        'vessel v' || v_next || CASE WHEN COALESCE(p_change_note, '') <> '' THEN ': ' || p_change_note ELSE '' END,
        v_next
      ) RETURNING * INTO ident;
      INSERT INTO memory_events
        (user_id, character_id, event_type, content, payload, emotional_weight, identity_version, dedupe_key, source)
      VALUES (
        p_user_id, p_character_id, 'vessel_changed',
        'My vessel changed (v' || v_next || ')' ||
          CASE WHEN COALESCE(p_change_note, '') <> '' THEN ': ' || p_change_note ELSE '' END,
        jsonb_build_object('vessel_version', v_next, 'config', p_config),
        0.45, ident.version, 'vessel:' || p_character_id || ':' || v_next, 'vessel'
      ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
      RETURN jsonb_build_object('vessel', to_jsonb(v_row), 'identity_version', ident.version);
    END $$;
  `);
}

beforeAll(async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://storage.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role";
  process.env.SUPABASE_MODEL_BUCKET = "character-models";
  await applyVesselTestSchema();
  const app: Express = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/vessel", vesselRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  objects.clear();
  deleted.length = 0;
});

async function call(userId: string | null, method: string, path: string, body?: unknown, redirect = "manual" as RequestRedirect) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json, location: res.headers.get("location"), headers: res.headers };
}

async function seedCharacter(userId: string, characterId: string, name = "Serenity") {
  await getPool().query(
    `INSERT INTO user_entities (user_id, entity_name, entity_id, data)
     VALUES ($1, 'Character', $2, $3::jsonb)`,
    [userId, characterId, JSON.stringify({ id: characterId, name })],
  );
}

describe("migration contract", () => {
  it("creates a private 50 MB character-models bucket with owner-only RLS and no new table", () => {
    const sql = readFileSync(
      new URL("../../../supabase/migrations/20261110220000_character_models.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("'character-models'");
    expect(sql).toContain("52428800");
    expect(sql).toContain("model/gltf-binary");
    expect(sql).toContain("model/vrm");
    expect(sql).toContain("application/octet-stream");
    expect(sql).toContain("(storage.foldername(name))[1] = (auth.jwt() ->> 'sub')");
    expect(sql).toContain("character_models_select_own");
    expect(sql).toMatch(/information_schema\.tables[\s\S]*storage[\s\S]*buckets/);
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });
});

describe("POST /vessel/:id/model/sign", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await call(null, "POST", "/vessel/c1/model/sign", { byteSize: 100, ext: "vrm" });
    expect(res.status).toBe(401);
  });

  it("rejects a character the caller does not own", async () => {
    const owner = user("sign_owner");
    const other = user("sign_other");
    const characterId = `${PREFIX}char_sign`;
    await seedCharacter(owner, characterId);
    const res = await call(other, "POST", `/vessel/${characterId}/model/sign`, { byteSize: 100, ext: "vrm" });
    expect(res.status).toBe(404);
  });

  it("rejects oversized declarations and unsupported extensions", async () => {
    const owner = user("sign_ext");
    const characterId = `${PREFIX}char_ext`;
    await seedCharacter(owner, characterId);
    const big = await call(owner, "POST", `/vessel/${characterId}/model/sign`, {
      byteSize: MODEL_MAX_BYTES + 1,
      ext: "vrm",
    });
    expect(big.status).toBe(413);
    const gltf = await call(owner, "POST", `/vessel/${characterId}/model/sign`, {
      byteSize: 100,
      filename: "hero.gltf",
    });
    expect(gltf.status).toBe(400);
    expect(gltf.json.code).toBe("invalid_model_ext");
    expect(gltf.json.error).toMatch(/gltf/i);
    const fbx = await call(owner, "POST", `/vessel/${characterId}/model/sign`, {
      byteSize: 100,
      ext: "fbx",
    });
    expect(fbx.status).toBe(400);
  });

  it("returns a signed upload URL for an owned companion", async () => {
    const owner = user("sign_ok");
    const characterId = `${PREFIX}char_ok`;
    await seedCharacter(owner, characterId);
    const res = await call(owner, "POST", `/vessel/${characterId}/model/sign`, {
      byteSize: 2048,
      filename: "serenity.vrm",
    });
    expect(res.status).toBe(201);
    expect(res.json.uploadUrl).toMatch(/^https:\/\/storage\.test\/upload\//);
    expect(res.json.path).toMatch(new RegExp(`^${owner.replace(/[^A-Za-z0-9_-]/g, "_")}/`));
    expect(res.json.path).toMatch(/\.vrm$/);
    expect(res.json.maxBytes).toBe(MODEL_MAX_BYTES);
    expect(res.json.bucket).toBe("character-models");
  });
});

describe("POST /vessel/:id/model/complete and GET model", () => {
  async function signPath(owner: string, characterId: string, ext: "vrm" | "glb" = "vrm") {
    const signed = await call(owner, "POST", `/vessel/${characterId}/model/sign`, { byteSize: 2048, ext });
    expect(signed.status).toBe(201);
    return signed.json.path as string;
  }

  it("inspects a VRM, stores expression metadata, and serves the model only to the owner", async () => {
    const owner = user("ok");
    const other = user("other");
    const characterId = `${PREFIX}char_vrm`;
    await seedCharacter(owner, characterId);
    const path = await signPath(owner, characterId, "vrm");
    objects.set(path, vrmBytes());

    const complete = await call(owner, "POST", `/vessel/${characterId}/model/complete`, { path });
    expect(complete.status).toBe(201);
    expect(complete.json.model.format).toBe("vrm");
    expect(complete.json.model.kind).toBe("vrm");
    expect(complete.json.model.humanoid).toBe(true);
    expect(complete.json.model.animationCount).toBe(1);
    expect(complete.json.model.visemes).toEqual(["aa", "ih", "ou", "ee", "oh"]);
    expect(complete.json.model.expressions).toEqual(expect.arrayContaining(["happy", "aa", "wink"]));
    expect(complete.json.model.url).toBe(`/api/vessel/${encodeURIComponent(characterId)}/model`);
    expect(complete.json.vessel.config.model.path).toBe(path);
    expect(complete.json.vessel.version).toBe(1);
    expect(deleted).toEqual([]);

    const gotten = await call(owner, "GET", `/vessel/${characterId}/model`);
    expect(gotten.status).toBe(302);
    expect(gotten.location).toBe(`https://storage.test/download/${path}?sig=1`);

    const stolen = await call(other, "GET", `/vessel/${characterId}/model`);
    expect(stolen.status).toBe(404);

    const stolenComplete = await call(other, "POST", `/vessel/${characterId}/model/complete`, { path });
    expect(stolenComplete.status).toBe(404);
  });

  it("rejects bad magic, deletes the object, and does not write a vessel version", async () => {
    const owner = user("bad");
    const characterId = `${PREFIX}char_bad`;
    await seedCharacter(owner, characterId);
    const path = await signPath(owner, characterId);
    objects.set(path, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]));
    const complete = await call(owner, "POST", `/vessel/${characterId}/model/complete`, { path });
    expect(complete.status).toBe(400);
    expect(deleted).toContain(path);
    expect(objects.has(path)).toBe(false);
    const current = await call(owner, "GET", `/vessel/${characterId}`);
    expect(current.json.vessel).toBeNull();
  });

  it("rejects an oversized stored object and deletes it", async () => {
    const owner = user("big");
    const characterId = `${PREFIX}char_big`;
    await seedCharacter(owner, characterId);
    const path = await signPath(owner, characterId);
    const huge = new Uint8Array(20);
    huge[0] = 0x67;
    objects.set(path, huge);
    // Pretend Storage reported a size over the cap without holding 50MB+1 in memory.
    const storage = await import("../src/lib/vessel/modelStorage");
    vi.mocked(storage.getObjectMetadata).mockResolvedValueOnce({ byteSize: MODEL_MAX_BYTES + 1, etag: null });
    const complete = await call(owner, "POST", `/vessel/${characterId}/model/complete`, { path });
    expect(complete.status).toBe(413);
    expect(deleted).toContain(path);
  });

  it("rejects a path outside the caller's prefix and does not delete someone else's object", async () => {
    const owner = user("path");
    const characterId = `${PREFIX}char_path`;
    await seedCharacter(owner, characterId);
    const foreign = "other_user/other_char/11111111-1111-4111-8111-111111111111.vrm";
    objects.set(foreign, vrmBytes());
    const complete = await call(owner, "POST", `/vessel/${characterId}/model/complete`, { path: foreign });
    expect(complete.status).toBe(403);
    expect(deleted).toEqual([]);
    expect(objects.has(foreign)).toBe(true);
  });

  it("rejects a .vrm file without a VRM extension and deletes it", async () => {
    const owner = user("novrm");
    const characterId = `${PREFIX}char_novrm`;
    await seedCharacter(owner, characterId);
    const path = await signPath(owner, characterId, "vrm");
    objects.set(path, glbBytes());
    const complete = await call(owner, "POST", `/vessel/${characterId}/model/complete`, { path });
    expect(complete.status).toBe(400);
    expect(complete.json.error).toMatch(/VRM/);
    expect(deleted).toContain(path);
  });

  it("GET ?as=json returns a signed url and expiresIn with Cache-Control no-store", async () => {
    const owner = user("json");
    const other = user("json_other");
    const characterId = `${PREFIX}char_json`;
    await seedCharacter(owner, characterId);
    const path = await signPath(owner, characterId, "vrm");
    objects.set(path, vrmBytes());
    const complete = await call(owner, "POST", `/vessel/${characterId}/model/complete`, { path });
    expect(complete.status).toBe(201);

    const jsonGet = await call(owner, "GET", `/vessel/${characterId}/model?as=json`);
    expect(jsonGet.status).toBe(200);
    expect(jsonGet.location).toBeNull();
    expect(jsonGet.json).toEqual({
      url: `https://storage.test/download/${path}?sig=1`,
      expiresIn: MODEL_SIGNED_DOWNLOAD_TTL_S,
    });
    expect(jsonGet.headers.get("cache-control")).toBe("no-store");

    const defaultGet = await call(owner, "GET", `/vessel/${characterId}/model`);
    expect(defaultGet.status).toBe(302);
    expect(defaultGet.location).toBe(`https://storage.test/download/${path}?sig=1`);

    const stolen = await call(other, "GET", `/vessel/${characterId}/model?as=json`);
    expect(stolen.status).toBe(404);
    expect(stolen.json).toMatchObject({ error: expect.any(String) });
    expect(stolen.location).toBeNull();
  });

  it("GET ?as=json returns 404 JSON when the companion has no model", async () => {
    const owner = user("nomodel");
    const characterId = `${PREFIX}char_nomodel`;
    await seedCharacter(owner, characterId);
    const res = await call(owner, "GET", `/vessel/${characterId}/model?as=json`);
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: "No model", code: "model_not_found" });
    expect(res.location).toBeNull();
  });
});
