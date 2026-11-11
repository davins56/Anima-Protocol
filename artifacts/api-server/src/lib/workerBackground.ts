/**
 * Keep a companion generate alive after the browser disconnects.
 *
 * Workers cancel an invocation when the client leaves unless the promise was
 * passed to `ctx.waitUntil`. That grace is 30 seconds after disconnect.
 * Node does not need the registration; the process keeps the promise.
 */

type WaitUntil = (promise: Promise<unknown>) => void;

const tokens = new Map<string, WaitUntil>();

export function registerWorkerWaitUntil(token: string, waitUntil: WaitUntil): void {
  if (!token) return;
  tokens.set(token, waitUntil);
}

export function clearWorkerWaitUntil(token: string): void {
  if (!token) return;
  tokens.delete(token);
}

export function scheduleWorkerBackground(
  promise: Promise<unknown>,
  token: string | null | undefined,
): void {
  if (!token) return;
  const waitUntil = tokens.get(token);
  if (!waitUntil) return;
  try {
    waitUntil(promise);
  } catch {
    // The response path still finishes. Node keeps the work either way.
  }
}
