// Shared #763 wire fixtures (docs/contracts/fixtures/situational-scenes.v1.json),
// with "@rows.<name>" references resolved to the full row objects.
import raw from "../../../../docs/contracts/fixtures/situational-scenes.v1.json";

function resolve(value) {
  if (typeof value === "string" && value.startsWith("@rows.")) {
    return structuredClone(raw.rows[value.slice(6)]);
  }
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
  }
  return value;
}

/** A fresh, resolved copy for each call (tests may mutate it). */
export function sceneFixtures() {
  return resolve(raw);
}

/** An Error shaped like `request()` / `chatHttpError` throws for an HTTP fixture. */
export function httpFixtureError({ status, body }) {
  const err = new Error(body?.error || "error");
  err.status = status;
  err.code = body?.code;
  err.payload = body;
  return err;
}

export async function* sseFrames(frames) {
  for (const frame of frames) yield frame;
}
