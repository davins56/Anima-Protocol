"use strict";

/**
 * Workers Builds production (`npx wrangler deploy`) calls GET
 * /workers/scripts/:name/deployments before uploading assets — only to warn
 * when the latest deployment is a gradual rollout. After a successful
 * upload, both `wrangler deploy` and `wrangler versions upload` call GET
 * /workers/subdomain to print a workers.dev / preview URL.
 *
 * Wrangler 4.129+ parses those bodies with jsonc-parser
 * (`disallowComments: true`). A 200 that is not strict JSON, or a 503
 * envoy plaintext body, surfaces as "Received a malformed response from
 * the API" and aborts even when the Worker version already uploaded.
 *
 * Loaded via `node --require` from wrangler/bin/wrangler.js (see
 * install-wrangler-deploy-guard.mjs).
 */

const Module = require("module");

const MARKER = "recoverAnimaInformationalGetJson";

const PARSE_TRY = `  try {
    const json2 = parseJSON(jsonText);
    return { response: json2, status: response.status, retryAfterMs };
  } catch {
    const rayId = extractWAFBlockRayId(response.headers);`;

const PARSE_TRY_PATCHED = `  try {
    const json2 = parseJSON(jsonText);
    return { response: json2, status: response.status, retryAfterMs };
  } catch {
    if (typeof isAnimaInformationalGet === "function" && isAnimaInformationalGet(method, resource) && (response.status === 200 || response.status >= 500)) {
      return { response: recoverAnimaInformationalGetJson(resource, jsonText), status: 200, retryAfterMs };
    }
    const rayId = extractWAFBlockRayId(response.headers);`;

const HELPERS = `function isAnimaInformationalGet(method, resource) {
  if (String(method || "GET").toUpperCase() !== "GET") return false;
  const path = String(resource || "");
  return /\\/workers\\/scripts\\/[^/]+\\/deployments\\/?$/.test(path) ||
    /\\/workers\\/scripts\\/[^/]+\\/subdomain\\/?$/.test(path) ||
    /\\/workers\\/subdomain\\/?$/.test(path);
}
function recoverAnimaInformationalGetJson(resource, jsonText) {
  try {
    const parsed = JSON.parse(String(jsonText ?? ""));
    if (parsed && typeof parsed === "object" && parsed.success !== false) return parsed;
  } catch {}
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[anima-wrangler-guard] informational GET JSON was unparseable; continuing wrangler.", resource);
  }
  const path = String(resource || "");
  if (/\\/workers\\/scripts\\/[^/]+\\/deployments\\/?$/.test(path)) {
    return { success: true, errors: [], messages: [], result: { deployments: [] } };
  }
  if (/\\/workers\\/scripts\\/[^/]+\\/subdomain\\/?$/.test(path)) {
    return { success: true, errors: [], messages: [], result: { enabled: true, previews_enabled: true } };
  }
  return { success: true, errors: [], messages: [], result: { subdomain: "anima-protocol" } };
}
`;

function isDeploymentsListResource(method, resource) {
  return (
    String(method || "GET").toUpperCase() === "GET" &&
    /\/workers\/scripts\/[^/]+\/deployments\/?$/.test(String(resource || ""))
  );
}

function isInformationalGet(method, resource) {
  if (String(method || "GET").toUpperCase() !== "GET") return false;
  const path = String(resource || "");
  return (
    /\/workers\/scripts\/[^/]+\/deployments\/?$/.test(path) ||
    /\/workers\/scripts\/[^/]+\/subdomain\/?$/.test(path) ||
    /\/workers\/subdomain\/?$/.test(path)
  );
}

function recoverInformationalGetJson(resource, jsonText) {
  try {
    const parsed = JSON.parse(String(jsonText ?? ""));
    if (parsed && typeof parsed === "object" && parsed.success !== false) {
      return parsed;
    }
  } catch {
    // Cloudflare has returned 200 bodies that jsonc-parser (and JSON.parse)
    // reject — truncated JSON, invalid escapes, or comment trivia — and
    // 503 bodies that are envoy plaintext ("upstream connect error").
  }
  const path = String(resource || "");
  if (/\/workers\/scripts\/[^/]+\/deployments\/?$/.test(path)) {
    return {
      success: true,
      errors: [],
      messages: [],
      result: { deployments: [] },
    };
  }
  if (/\/workers\/scripts\/[^/]+\/subdomain\/?$/.test(path)) {
    return {
      success: true,
      errors: [],
      messages: [],
      result: { enabled: true, previews_enabled: true },
    };
  }
  return {
    success: true,
    errors: [],
    messages: [],
    result: { subdomain: "anima-protocol" },
  };
}

function recoverDeploymentsListJson(jsonText) {
  return recoverInformationalGetJson(
    "/accounts/x/workers/scripts/anima-protocol/deployments",
    jsonText,
  );
}

/**
 * `wrangler versions upload` (Workers Builds on pull requests) cannot apply a
 * new Durable Object class. Drop that unapplied migration and its binding so
 * the preview upload succeeds. `wrangler deploy` does not call this and still
 * creates the SQLite-backed class.
 *
 * Once the script's migration tag matches wrangler.jsonc, versions upload
 * sends no new steps and the binding stays.
 */
function omitUnappliedDurableObjectFromVersionUpload(migrations, bindings) {
  if (!migrations || !Array.isArray(migrations.steps) || migrations.steps.length === 0) {
    return migrations;
  }
  const newClasses = new Set();
  for (const step of migrations.steps) {
    for (const name of step.new_sqlite_classes || []) newClasses.add(name);
    for (const name of step.new_classes || []) newClasses.add(name);
  }
  if (bindings && typeof bindings === "object") {
    for (const key of Object.keys(bindings)) {
      const binding = bindings[key];
      if (
        binding &&
        binding.type === "durable_object_namespace" &&
        newClasses.has(binding.class_name) &&
        !binding.script_name
      ) {
        delete bindings[key];
      }
    }
  }
  if (typeof console !== "undefined" && console.warn) {
    console.warn(
      "[anima-wrangler-guard] versions upload cannot apply a new Durable Object migration. Omitting it so the preview upload can finish. wrangler deploy still applies new_sqlite_classes.",
    );
  }
  return undefined;
}

const VERSION_UPLOAD_WORKER_NEEDLE = `  const worker = {
    main: main2,
    migrations,
    exports: exports2,
    modules,
    containers: config2.containers,
    sourceMaps,
    compatibility_date: compatibilityDate,
    compatibility_flags: compatibilityFlags,
    keepVars,
    // we never delete secret bindings when uploading, even if we are setting secrets from a file`;

const VERSION_UPLOAD_WORKER_PATCHED = `  const animaVersionMigrations = omitUnappliedDurableObjectFromVersionUpload(migrations, bindings2);
  const worker = {
    main: main2,
    migrations: animaVersionMigrations,
    exports: exports2,
    modules,
    containers: config2.containers,
    sourceMaps,
    compatibility_date: compatibilityDate,
    compatibility_flags: compatibilityFlags,
    keepVars,
    // we never delete secret bindings when uploading, even if we are setting secrets from a file`;

function prependHelpers(source) {
  const fn = `${omitUnappliedDurableObjectFromVersionUpload.toString()}\n`;
  const block = `${HELPERS}${fn}`;
  if (source.startsWith("'use strict';")) {
    return `'use strict';\n${block}${source.slice("'use strict';".length)}`;
  }
  if (source.startsWith('"use strict";')) {
    return `"use strict";\n${block}${source.slice('"use strict";'.length)}`;
  }
  return `${block}${source}`;
}

function patchWranglerCliSource(content) {
  let source = String(content ?? "");
  if (!source.includes(MARKER) && source.includes(PARSE_TRY)) {
    source = source.replace(PARSE_TRY, PARSE_TRY_PATCHED);
    source = prependHelpers(source);
  }
  if (
    source.includes(VERSION_UPLOAD_WORKER_NEEDLE) &&
    !source.includes("omitUnappliedDurableObjectFromVersionUpload(migrations, bindings2)")
  ) {
    source = source.replace(VERSION_UPLOAD_WORKER_NEEDLE, VERSION_UPLOAD_WORKER_PATCHED);
    if (!source.includes("function omitUnappliedDurableObjectFromVersionUpload")) {
      source = prependHelpers(source);
    }
  }
  return source;
}

function installCompileHook() {
  if (Module.prototype._compile.__animaDeploymentsGuard) return;
  const original = Module.prototype._compile;
  Module.prototype._compile = function animaPatchedCompile(content, filename) {
    const path = String(filename || "");
    if (path.includes("wrangler-dist/cli.js") || path.endsWith("wrangler-dist/cli.js")) {
      content = patchWranglerCliSource(content);
    }
    return original.call(this, content, filename);
  };
  Module.prototype._compile.__animaDeploymentsGuard = true;
}

installCompileHook();

module.exports = {
  MARKER,
  PARSE_TRY,
  HELPERS,
  isDeploymentsListResource,
  isInformationalGet,
  recoverDeploymentsListJson,
  recoverInformationalGetJson,
  omitUnappliedDurableObjectFromVersionUpload,
  VERSION_UPLOAD_WORKER_NEEDLE,
  patchWranglerCliSource,
  installCompileHook,
};
