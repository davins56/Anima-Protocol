import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function parseJsonc(source: string): Record<string, unknown> {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutComments) as Record<string, unknown>;
}

describe("Cloudflare wrangler config", () => {
  const config = parseJsonc(
    readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8"),
  );
  const workerSource = readFileSync(
    path.join(repoRoot, "artifacts/api-server/src/worker.ts"),
    "utf8",
  );
  const assets = config.assets as Record<string, unknown>;

  it("uses worker.ts as the fetch entry for anima-protocol", () => {
    expect(config.name).toBe("anima-protocol");
    expect(config.main).toBe("artifacts/api-server/src/worker.ts");
    expect(config.compatibility_flags).toEqual(
      expect.arrayContaining([
        "nodejs_compat",
        "nodejs_compat_populate_process_env",
      ]),
    );
  });

  it("serves the SPA from the root pnpm build output with an ASSETS binding", () => {
    expect(assets.directory).toBe("./dist");
    expect(assets.binding).toBe("ASSETS");
    expect(assets.not_found_handling).toBe("single-page-application");
  });

  it("runs the Worker first for /api so Express handles healthz, store, and Clerk", () => {
    expect(assets.run_worker_first).toEqual(
      expect.arrayContaining(["/api", "/api/*", "/assets", "/assets/*"]),
    );
    expect(workerSource).toContain("isWorkerApiPath");
    expect(workerSource).toContain("fetchApiThroughExpress");
    expect(workerSource).toContain("expressHandler");
    expect(workerSource).toContain("apexRedirectForWww");
    expect(workerSource).toContain("fetchAssetsRejectingSpaHtml");
    expect(workerSource).toContain("httpServerHandler");
    expect(workerSource).toContain("app.listen(WORKER_API_PORT)");
    expect(workerSource).toContain("httpServerHandler({ port: WORKER_API_PORT })");
    expect(workerSource).toContain("applyCloudflareRequestEnv(env)");
    expect(workerSource).toContain("cloudflare:workers");
    expect(workerSource).toContain("cloudflareEnvBootstrap");
  });

  it("runs the Worker first for /assets so missing hashed JS is not HTML-fallback", () => {
    expect(assets.not_found_handling).toBe("single-page-application");
    expect(assets.html_handling).toBeUndefined();
    expect(assets.run_worker_first).toEqual(
      expect.arrayContaining(["/assets", "/assets/*"]),
    );
    expect(workerSource).toContain("fetchAssetsRejectingSpaHtml");
    expect(readFileSync(path.join(repoRoot, "package.json"), "utf8")).toContain(
      "assertSpaAssets.js dist",
    );
  });

  it("excludes Netlify _redirects from Cloudflare asset uploads", () => {
    const assetsIgnore = readFileSync(
      path.join(repoRoot, "artifacts/anima-protocol/public/.assetsignore"),
      "utf8",
    );
    expect(assetsIgnore).toMatch(/_redirects/);
    expect(readFileSync(path.join(repoRoot, "package.json"), "utf8")).toContain(
      "rm -f dist/_redirects",
    );
    const headers = readFileSync(
      path.join(repoRoot, "artifacts/anima-protocol/public/_headers"),
      "utf8",
    );
    expect(headers).toContain("/assets/*");
    expect(headers).toContain("max-age=31536000, immutable");
    expect(assetsIgnore).not.toMatch(/^_headers$/m);
  });

  it("persists Secrets Store bindings only for store entries that already exist", () => {
    const bindings = config.secrets_store_secrets as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(bindings)).toBe(true);
    // These four exist in store a31e40473ef34db896b5bc1e6c1c4b86 today
    // (OpenRouter is created in the same deploy window as this binding).
    // Fly LLM names must NOT be bound until the operator creates those
    // store entries (Fly URL / PROXY_AUTH_TOKEN). A binding for a missing
    // secret_name fails wrangler deploy and takes down the site.
    const declaredNames = [
      "CLERK_SECRET_KEY",
      "CLERK_PUBLISHABLE_KEY",
      "DATABASE_URL",
      "OPENROUTER_API_KEY",
    ];
    expect(bindings.map((row) => row.binding).sort()).toEqual(
      [...declaredNames].sort(),
    );
    for (const name of declaredNames) {
      const row = bindings.find((entry) => entry.binding === name);
      expect(row).toEqual({
        binding: name,
        store_id: "a31e40473ef34db896b5bc1e6c1c4b86",
        secret_name: name,
      });
    }
    const bound = new Set(bindings.map((row) => row.binding));
    expect(bound.has("ANIMA_LOCAL_LLM_BASE_URL")).toBe(false);
    expect(bound.has("ANIMA_LOCAL_LLM_API_KEY")).toBe(false);
    expect(bound.has("OPENROUTER_API_KEY")).toBe(true);
    const source = readFileSync(
      path.join(repoRoot, "wrangler.jsonc"),
      "utf8",
    );
    expect(source).toMatch(
      /Adding a binding for a secret_name that does not exist yet/,
    );
    expect(source).toMatch(/Create the secret_name in store/);
    expect(source).toMatch(/ANIMA_LOCAL_LLM_BASE_URL/);
    expect(source).toMatch(/ANIMA_LOCAL_LLM_API_KEY/);
    expect(source).toMatch(/OPENROUTER_API_KEY/);
  });

  it("does not embed secrets in the committed Worker config", () => {
    const vars = (config.vars ?? {}) as Record<string, unknown>;
    expect(vars.NODE_ENV).toBe("production");
    expect(vars.ANIMA_RUNTIME).toBe("worker");
    expect(vars.ANIMA_LOCAL_LLM_BACKEND).toBe("ollama");
    expect(vars.ANIMA_OLLAMA_MODEL_STANDARD).toBe("anima-chat");
    expect(vars.ANIMA_OPENROUTER_FREE).toBe("true");
    // Public Fly URL stays out of committed vars so a missing Fly host
    // cannot put `local` in the provider chain. Bind it only after the
    // Secrets Store entry exists (see wrangler.jsonc runbook).
    expect(vars).not.toHaveProperty("ANIMA_LOCAL_LLM_BASE_URL");
    expect(vars).not.toHaveProperty("ANIMA_LOCAL_LLM_API_KEY");
    expect(vars).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(Object.keys(vars).sort()).toEqual(
      [
        "ANIMA_LOCAL_LLM_BACKEND",
        "ANIMA_OLLAMA_MODEL_STANDARD",
        "ANIMA_OPENROUTER_FREE",
        "ANIMA_RUNTIME",
        "NODE_ENV",
      ].sort(),
    );
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(/sk_live_|sk_test_|pk_live_|pk_test_/);
    expect(serialized).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(serialized).not.toMatch(/connectionString/i);
    // Hyperdrive id only — never the origin connection string or a password.
    const hyperdrive = config.hyperdrive as Array<Record<string, unknown>>;
    expect(Array.isArray(hyperdrive)).toBe(true);
    expect(hyperdrive.length).toBeGreaterThan(0);
    for (const row of hyperdrive) {
      expect(Object.keys(row).sort()).toEqual(["binding", "id"]);
      expect(row.binding).toBe("HYPERDRIVE");
      expect(String(row.id)).toMatch(
        /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i,
      );
      expect(row).not.toHaveProperty("connectionString");
      expect(row).not.toHaveProperty("localConnectionString");
    }
    const bindings = (config.secrets_store_secrets ?? []) as Array<
      Record<string, unknown>
    >;
    for (const row of bindings) {
      expect(row).not.toHaveProperty("value");
      expect(row).not.toHaveProperty("secret");
      expect(Object.keys(row).sort()).toEqual([
        "binding",
        "secret_name",
        "store_id",
      ]);
      for (const field of Object.values(row)) {
        expect(String(field)).not.toMatch(/sk_live_|sk_test_|pk_live_|pk_test_/);
        expect(String(field)).not.toMatch(/postgres(?:ql)?:\/\//i);
      }
    }
  });

  it("does not assume a wrangler www route until the zone rule keeps ${1}", () => {
    expect(config.routes ?? []).toEqual([]);
    const wrangler = readFileSync(
      path.join(repoRoot, "wrangler.jsonc"),
      "utf8",
    );
    expect(wrangler).toMatch(/scripts\/cloudflare\/www-redirect\.md/);
    expect(wrangler).toMatch(/Redirect www to root/);
    expect(wrangler).toMatch(/Do not add www\.anima-protocol\.com routes/);
    const notes = readFileSync(
      path.join(repoRoot, "scripts/cloudflare/www-redirect.md"),
      "utf8",
    );
    expect(notes).toMatch(/\$\{1\}/);
    expect(notes).toMatch(/Do \*\*not\*\* add a `www\.anima-protocol\.com` route/);
  });

  it("binds Hyperdrive anima-postgres as HYPERDRIVE", () => {
    expect(config.hyperdrive).toEqual([
      {
        binding: "HYPERDRIVE",
        id: "bae77549623a4320b10211ca499fdb93",
      },
    ]);
  });

  it("documents the Hyperdrive binding without embedding a connection string", () => {
    const source = readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8");
    expect(source).toMatch(/"binding": "HYPERDRIVE"/);
    expect(source).toMatch(/"id": "bae77549623a4320b10211ca499fdb93"/);
    expect(source).toMatch(/scripts\/cloudflare\/hyperdrive\.md/);
    expect(source).toMatch(/secrets_store_secrets/);
    expect(source).toMatch(/Keep the Secrets Store DATABASE_URL/);
    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^\s"]+/i);
  });
});
