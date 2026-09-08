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
    if (typeof isAnimaInformationalGet === "function" && isAnimaInformationalGet(method, resource) && response.status >= 500) {
      return { response: recoverAnimaInformationalGetJson(resource, jsonText), status: 200, retryAfterMs };
    }
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
    console.warn("[anima-wrangler-guard] informational GET was unparseable or 5xx; continuing wrangler.", resource);
  }
  const path = String(resource || "");
  if (/\\/workers\\/scripts\\/[^/]+\\/deployments\\/?$/.test(path)) {
    return { success: true, errors: [], messages: [], result: { deployments: [] } };
  }
  if (/\\/workers\\/scripts\\/[^/]+\\/subdomain\\/?$/.test(path)) {
    return { success: true, errors: [], messages: [], result: { enabled: true, previews_enabled: false } };
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
      result: { enabled: true, previews_enabled: false },
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

function patchWranglerCliSource(content) {
  const source = String(content ?? "");
  if (source.includes(MARKER)) return source;
  if (!source.includes(PARSE_TRY)) return source;
  let next = source.replace(PARSE_TRY, PARSE_TRY_PATCHED);
  if (next.startsWith("'use strict';")) {
    next = `'use strict';\n${HELPERS}${next.slice("'use strict';".length)}`;
  } else if (next.startsWith('"use strict";')) {
    next = `"use strict";\n${HELPERS}${next.slice('"use strict";'.length)}`;
  } else {
    next = `${HELPERS}${next}`;
  }
  return next;
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
  patchWranglerCliSource,
  installCompileHook,
};
