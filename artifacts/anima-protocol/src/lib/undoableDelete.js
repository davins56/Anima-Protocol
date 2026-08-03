// Delete an entity record with a short "Undo" grace window.
//
// The local entity store (see api/base44Client) deletes records outright, but
// its update() acts as an upsert: calling update(id, fullRecord) re-creates the
// record with its original id, created_date and field values intact. We exploit
// that to restore a just-deleted item if the user clicks Undo before the toast
// expires.

import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

const UNDO_DURATION_MS = 6000;

// entity   — entity name on base44.entities (e.g. "Character")
// item     — the full record being deleted (must include id + all fields)
// label    — human label for the toast (e.g. "Character")
// onChange — optional callback re-run after delete and after restore so the
//            calling page can refresh its view.
export async function deleteWithUndo({ entity, item, label = "Item", onChange }) {
  if (!item || !item.id) return;

  const snapshot = { ...item };

  await base44.entities[entity].delete(snapshot.id);
  if (onChange) await onChange();

  toast(`${label} deleted`, {
    description: "Tap undo to restore it.",
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          await base44.entities[entity].update(snapshot.id, snapshot);
          if (onChange) await onChange();
          toast.success(`${label} restored`);
        } catch (err) {
          console.error(`Failed to restore ${label}:`, err);
          toast.error(`Couldn't restore ${label.toLowerCase()}`);
        }
      },
    },
  });
}

// Delete a single element from an array-valued field on one record, with a
// short "Undo" grace window. Unlike deleteWithUndo (which restores whole
// entities), this targets one item inside a list — e.g. a message inside a
// ChatSession.messages array — and re-inserts it at its original index on undo.
//
// To stay correct even if the array changes during the grace window, both the
// delete and the restore re-read the record fresh from the store rather than
// trusting a stale snapshot of the surrounding array.
//
// entity   — entity name on base44.entities (e.g. "ChatSession")
// recordId — id of the record holding the array
// field    — name of the array field (defaults to "messages")
// index    — index of the element to delete
// label    — human label for the toast (e.g. "Message")
// onChange — optional callback re-run after delete and after restore so the
//            calling page can refresh its view.
export async function deleteArrayItemWithUndo({
  entity,
  recordId,
  field = "messages",
  index,
  label = "Message",
  onChange,
}) {
  const record = await base44.entities[entity].get(recordId);
  if (!record) return;

  const original = Array.isArray(record[field]) ? record[field] : [];
  if (index < 0 || index >= original.length) return;

  const removed = original[index];
  const afterDelete = [...original.slice(0, index), ...original.slice(index + 1)];

  await base44.entities[entity].update(recordId, { [field]: afterDelete });
  if (onChange) await onChange();

  toast(`${label} deleted`, {
    description: "Tap undo to restore it.",
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          const current = await base44.entities[entity].get(recordId);
          const currentArr = Array.isArray(current?.[field]) ? current[field] : [];
          const insertAt = Math.min(index, currentArr.length);
          const restored = [
            ...currentArr.slice(0, insertAt),
            removed,
            ...currentArr.slice(insertAt),
          ];
          await base44.entities[entity].update(recordId, { [field]: restored });
          if (onChange) await onChange();
          toast.success(`${label} restored`);
        } catch (err) {
          console.error(`Failed to restore ${label}:`, err);
          toast.error(`Couldn't restore ${label.toLowerCase()}`);
        }
      },
    },
  });
}

// Delete many records at once with a single "Undo" grace window.
//
// Like deleteWithUndo, restore relies on update() acting as an upsert so each
// record comes back with its original id, created_date and fields intact.
//
// entity   — entity name on base44.entities (e.g. "Character")
// items    — array of full records being deleted (each must include id + fields)
// label    — plural human label for the toast (e.g. "characters")
// onChange — optional callback re-run after delete and after restore so the
//            calling page can refresh its view.
export async function deleteAllWithUndo({ entity, items, label = "items", onChange }) {
  if (!Array.isArray(items) || items.length === 0) return;

  const snapshots = items.map((item) => ({ ...item }));

  await Promise.all(snapshots.map((s) => base44.entities[entity].delete(s.id)));
  if (onChange) await onChange();

  const count = snapshots.length;

  toast(`${count} ${label} deleted`, {
    description: "Tap undo to restore them.",
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          await Promise.all(
            snapshots.map((s) => base44.entities[entity].update(s.id, s))
          );
          if (onChange) await onChange();
          toast.success(`${count} ${label} restored`);
        } catch (err) {
          console.error(`Failed to restore ${label}:`, err);
          toast.error(`Couldn't restore ${label}`);
        }
      },
    },
  });
}
