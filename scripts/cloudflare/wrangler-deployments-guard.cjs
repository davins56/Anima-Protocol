"use strict";

/**
 * Workers Builds production (`npx wrangler deploy`) calls GET
 * /workers/scripts/:name/deployments before uploading assets — only to warn
 * when the latest deployment is a gradual rollout. Wrangler 4.129+ parses
 * that 200 body with jsonc-parser (`disallowComments: true`). A malformed
 * or comment-shaped payload aborts deploy before clerk-js can ship.
 *
 * Preview builds use `wrangler versions upload` and never hit this GET.
 *
 * Loaded via `node --require` from wrangler/bin/wrangler.js (see
 * install-wrangler-deploy-guard.mjs).
 */

const Module = require("module");

const MARKER = "recoverAnimaDeploymentsListJson";

const PARSE_TRY = `  try {
    const json2 = parseJSON(jsonText);
    return { response: json2, status: response.status, retryAfterMs };
  } catch {
    const rayId = extractWAFBlockRayId(response.headers);`;

const PARSE_TRY_PATCHED = `  try {
    const json2 = parseJSON(jsonText);
    return { response: json2, status: response.status, retryAfterMs };
  } catch {
    if (typeof isAnimaDeploymentsListGet === "function" && isAnimaDeploymentsListGet(method, resource)) {
      return { response: recoverAnimaDeploymentsListJson(jsonText), status: response.status, retryAfterMs };
    }
    const rayId = extractWAFBlockRayId(response.headers);`;

const HELPERS = `function isAnimaDeploymentsListGet(method, resource) {
  return String(method || "GET").toUpperCase() === "GET" &&
    /\\/workers\\/scripts\\/[^/]+\\/deployments\\/?$/.test(String(resource || ""));
}
function recoverAnimaDeploymentsListJson(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[anima-wrangler-guard] GET /deployments JSON was unparseable; continuing wrangler deploy.");
  }
  return {
    success: true,
    errors: [],
    messages: [],
    result: { deployments: [] },
  };
}
`;

function isDeploymentsListResource(method, resource) {
  return (
    String(method || "GET").toUpperCase() === "GET" &&
    /\/workers\/scripts\/[^/]+\/deployments\/?$/.test(String(resource || ""))
  );
}

function recoverDeploymentsListJson(jsonText) {
  try {
    const parsed = JSON.parse(String(jsonText ?? ""));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Cloudflare has returned 200 bodies that jsonc-parser (and JSON.parse)
    // reject — truncated JSON, invalid escapes, or comment trivia.
  }
  return {
    success: true,
    errors: [],
    messages: [],
    result: { deployments: [] },
  };
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
  recoverDeploymentsListJson,
  patchWranglerCliSource,
  installCompileHook,
};
