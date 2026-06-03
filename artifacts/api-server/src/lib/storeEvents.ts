import type { Response } from "express";

// In-memory pub/sub for cross-device live sync push (SSE).
//
// The api-server runs as a single Node process, so a per-process registry of
// open SSE responses keyed by user id is enough: whenever a user's data
// changes (any successful mutating /store request), we write a one-line "store
// changed" signal to every stream that user currently has open. Clients react
// by re-checking the cheap /revision token (which carries the real change
// detection + self-write suppression), so this signal is intentionally just a
// nudge and never carries data itself.
//
// If the process restarts or the stream drops, clients fall back to their
// periodic /revision poll, so no change is ever permanently lost.

const clients = new Map<string, Set<Response>>();

export function addClient(userId: string, res: Response): void {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(res);
}

export function removeClient(userId: string, res: Response): void {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

// Notify every stream the user currently has open that their store changed.
// Best-effort: a write to a half-closed socket throws synchronously, so we
// drop that client rather than letting it break the loop for the others.
export function notifyUser(userId: string): void {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  for (const res of set) {
    try {
      res.write("event: change\ndata: 1\n\n");
    } catch {
      set.delete(res);
    }
  }
  if (set.size === 0) clients.delete(userId);
}

export function clientCount(userId: string): number {
  return clients.get(userId)?.size ?? 0;
}
