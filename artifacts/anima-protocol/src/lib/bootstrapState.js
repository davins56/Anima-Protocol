// Lightweight bootstrap lifecycle flags shared between syncBootstrap and the
// store client. Kept in its own module (no imports from base44Client or
// syncBootstrap) so queryEntity can wait for starter seeding without creating a
// circular dependency.

let inProgress = false;
let settled = false;
let bootstrapPromise = null;

export function resetBootstrapState() {
  inProgress = false;
  settled = false;
  bootstrapPromise = null;
}

export function beginBootstrap(promise) {
  inProgress = true;
  settled = false;
  bootstrapPromise = promise;
}

export function endBootstrap() {
  inProgress = false;
  settled = true;
}

export function isBootstrapInProgress() {
  return inProgress;
}

export function isBootstrapSettled() {
  return settled;
}

// UI/store reads should wait until starter seeding finishes. Internal bootstrap
// reads pass `_bootstrapInternal: true` so they do not await the in-flight
// bootstrap promise (which would deadlock).
export async function ensureBootstrapComplete(timeoutMs = 20000) {
  if (settled) return;
  const deadline = Date.now() + timeoutMs;
  while (!bootstrapPromise && Date.now() < deadline) {
    if (settled) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!bootstrapPromise || settled) return;
  await Promise.race([
    bootstrapPromise.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
