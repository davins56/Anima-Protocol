/**
 * Synchronous send lock so a second tap cannot race React `isLoading`.
 * `if (!activeSession || isLoading) return` is not enough: two clicks before
 * the state update flushes both pass the guard.
 *
 * The acquire return value is an owner token. Release is a no-op if another
 * send already took the lock (the success path drops `isLoading` before
 * persist finishes).
 */

export function acquireChatSendLock(sendingRef, { hasSession, isLoading } = {}) {
  if (!hasSession || isLoading || sendingRef?.current) return false;
  const token = (sendingRef.generation || 0) + 1;
  sendingRef.generation = token;
  sendingRef.current = token;
  return token;
}

export function releaseChatSendLock(sendingRef, token) {
  if (!sendingRef) return;
  if (token != null && sendingRef.current !== token) return;
  sendingRef.current = false;
}
