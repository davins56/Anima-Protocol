# Anima Protocol — background trainer for the in-app own model.
#
# The app keeps everything in Postgres: lessons (the "__anima_model__"
# user_entities partition), the model state record, and the weights of each
# published version (own_model_blobs). Browsers download and run the current
# version; this job learns the pending lessons and publishes the next one.
#
# It runs on GitHub Actions every 15 minutes
# (.github/workflows/own-model-trainer.yml), or anywhere with DATABASE_URL:
#   python server/trainer.py            # one pass
#   python server/trainer.py --watch    # keep learning as lessons arrive
#   python server/trainer.py --check    # is there work? (no torch needed)
#
# CI logs are public for this repository: log counts and losses, never
# lesson text.
#
# The state record and lesson fields are shared with the api-server
# (artifacts/api-server/src/lib/ownModel.ts); keep the two in step.

import argparse
import datetime
import json
import os
import sys
import time

import _paths  # noqa: F401

PARTITION = "__anima_model__"
LESSON_ENTITY = "ModelLesson"
STATE_ENTITY = "ModelState"
STATE_ID = "state"
CHUNK_BYTES = 512 * 1024
MAX_LESSONS_PER_RUN = 40
TIME_BUDGET_S = 25 * 60
MAX_ATTEMPTS = 3
AFTER_REPLY_TOKENS = 96

# Must match ownModelBlobs in lib/db/src/schema/index.ts (drizzle push).
BLOBS_DDL = """CREATE TABLE IF NOT EXISTS "own_model_blobs" (
  "version" integer NOT NULL,
  "kind" text NOT NULL,
  "idx" integer NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "own_model_blobs_pk" PRIMARY KEY ("version", "kind", "idx")
)"""


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def log(message: str) -> None:
    print(f"[trainer] {message}", flush=True)


def is_pending(lesson: dict) -> bool:
    status = lesson.get("status")
    if status == "saved":
        return True
    return status == "failed" and int(lesson.get("attempts") or 0) < MAX_ATTEMPTS


def needs_rebuild(state: dict) -> bool:
    return int(state.get("rebuild_seq") or 0) > int(state.get("rebuilt_seq") or 0)


class Store:
    """The app's Postgres, spoken the way the api-server writes it."""

    def __init__(self, conn):
        self.conn = conn

    # ---- state ------------------------------------------------------------

    def ensure_blobs_table(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute(BLOBS_DDL)
        self.conn.commit()

    def read_state(self) -> dict:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT data FROM user_entities WHERE user_id = %s AND entity_name = %s AND entity_id = %s",
                (PARTITION, STATE_ENTITY, STATE_ID),
            )
            row = cur.fetchone()
        self.conn.commit()
        return dict(row[0]) if row else {}

    def merge_state(self, patch: dict) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_entities (user_id, entity_name, entity_id, data)
                   VALUES (%s, %s, %s, %s::jsonb)
                   ON CONFLICT (user_id, entity_name, entity_id)
                   DO UPDATE SET data = user_entities.data || EXCLUDED.data, updated_at = now()""",
                (PARTITION, STATE_ENTITY, STATE_ID, json.dumps(patch)),
            )
        self.conn.commit()

    def heartbeat(self, status: str, **fields) -> None:
        self.merge_state({"trainer": {"status": status, "at": _now(), **fields}})

    # ---- lessons ------------------------------------------------------------

    def lessons(self) -> list[dict]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT data FROM user_entities WHERE user_id = %s AND entity_name = %s ORDER BY created_at, id",
                (PARTITION, LESSON_ENTITY),
            )
            rows = cur.fetchall()
        self.conn.commit()
        return [dict(r[0]) for r in rows]

    def count_pending(self) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                """SELECT count(*) FROM user_entities
                   WHERE user_id = %s AND entity_name = %s
                     AND (data->>'status' = 'saved'
                          OR (data->>'status' = 'failed' AND coalesce((data->>'attempts')::int, 0) < %s))""",
                (PARTITION, LESSON_ENTITY, MAX_ATTEMPTS),
            )
            (count,) = cur.fetchone()
        self.conn.commit()
        return int(count)

    def update_lesson(self, lesson: dict, patch: dict) -> bool:
        """Patch a lesson unless it was edited (or deleted) since it was read."""
        with self.conn.cursor() as cur:
            cur.execute(
                """UPDATE user_entities SET data = data || %s::jsonb, updated_at = now()
                   WHERE user_id = %s AND entity_name = %s AND entity_id = %s
                     AND coalesce(data->>'updated_date', '') = %s""",
                (json.dumps({**patch, "updated_date": _now()}), PARTITION, LESSON_ENTITY,
                 lesson["id"], lesson.get("updated_date") or ""),
            )
            changed = cur.rowcount > 0
        self.conn.commit()
        return changed

    # ---- blobs ------------------------------------------------------------

    def read_blob(self, version: int, kind: str) -> bytes:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT data FROM own_model_blobs WHERE version = %s AND kind = %s ORDER BY idx",
                (version, kind),
            )
            rows = cur.fetchall()
        self.conn.commit()
        if not rows:
            raise LookupError(f"version {version} has no {kind} weights stored")
        return b"".join(bytes(r[0]) for r in rows)

    def next_version(self, state: dict) -> int:
        with self.conn.cursor() as cur:
            cur.execute("SELECT coalesce(max(version), 0) FROM own_model_blobs")
            (top,) = cur.fetchone()
        self.conn.commit()
        known = [int(k) for k in (state.get("versions") or {})]
        return max([int(top), *known, int(state.get("current_version") or 0)]) + 1

    def publish(self, state: dict, *, inference: bytes, master: bytes, kind: str,
                lessons: int, expect_base: int) -> int | None:
        """Store a new version and make it current — unless a new base model
        was uploaded meanwhile, in which case this run's work is dropped."""
        import weights_io

        version = self.next_version(state)
        base_entry = (state.get("versions") or {}).get(str(expect_base)) or {}
        entry = {
            "kind": kind,
            "created_at": _now(),
            "lessons": lessons,
            **({"config": base_entry["config"]} if base_entry.get("config") else {}),
            "inference": {
                "bytes": len(inference),
                "chunks": -(-len(inference) // CHUNK_BYTES),
                "sha256": weights_io.sha256(inference),
            },
            "master": {"bytes": len(master), "chunks": -(-len(master) // CHUNK_BYTES)},
        }
        with self.conn.cursor() as cur:
            for blob_kind, data in (("inference", inference), ("master", master)):
                for idx in range(0, len(data), CHUNK_BYTES):
                    cur.execute(
                        "INSERT INTO own_model_blobs (version, kind, idx, data) VALUES (%s, %s, %s, %s)",
                        (version, blob_kind, idx // CHUNK_BYTES, data[idx:idx + CHUNK_BYTES]),
                    )
            cur.execute(
                """UPDATE user_entities
                   SET data = jsonb_set(
                         jsonb_set(data, '{versions}', coalesce(data->'versions', '{}'::jsonb) || %s::jsonb),
                         '{current_version}', to_jsonb(%s::int)),
                       updated_at = now()
                   WHERE user_id = %s AND entity_name = %s AND entity_id = %s
                     AND (data->>'base_version')::int = %s""",
                (json.dumps({str(version): entry}), version, PARTITION, STATE_ENTITY, STATE_ID, expect_base),
            )
            if cur.rowcount == 0:
                self.conn.rollback()
                return None
        self.conn.commit()
        return version

    def install_base(self, inference: bytes, master: bytes) -> int:
        """A newly trained base model: store it, serve it, and queue every
        lesson to be learned again on top of it. The api-server's upload does
        the same."""
        import weights_io

        state = self.read_state()
        version = self.next_version(state)
        with self.conn.cursor() as cur:
            for blob_kind, data in (("inference", inference), ("master", master)):
                for idx in range(0, len(data), CHUNK_BYTES):
                    cur.execute(
                        "INSERT INTO own_model_blobs (version, kind, idx, data) VALUES (%s, %s, %s, %s)",
                        (version, blob_kind, idx // CHUNK_BYTES, data[idx:idx + CHUNK_BYTES]),
                    )
            entry = {
                "kind": "base",
                "created_at": _now(),
                "lessons": 0,
                "config": weights_io.read_inference(inference)[0]["config"],
                "inference": {
                    "bytes": len(inference),
                    "chunks": -(-len(inference) // CHUNK_BYTES),
                    "sha256": weights_io.sha256(inference),
                },
                "master": {"bytes": len(master), "chunks": -(-len(master) // CHUNK_BYTES)},
            }
            cur.execute(
                """INSERT INTO user_entities (user_id, entity_name, entity_id, data)
                   VALUES (%s, %s, %s, %s::jsonb)
                   ON CONFLICT (user_id, entity_name, entity_id)
                   DO UPDATE SET data = user_entities.data || EXCLUDED.data, updated_at = now()""",
                (PARTITION, STATE_ENTITY, STATE_ID, json.dumps({
                    "base_version": version,
                    "current_version": version,
                    "versions": {str(version): entry},
                    "rebuilt_seq": int(state.get("rebuild_seq") or 0),
                })),
            )
            cur.execute(
                """UPDATE user_entities
                   SET data = data || '{"status": "saved", "attempts": 0}'::jsonb, updated_at = now()
                   WHERE user_id = %s AND entity_name = %s AND data->>'status' = 'learned'""",
                (PARTITION, LESSON_ENTITY),
            )
        self.conn.commit()
        self.prune({version})
        return version

    def prune(self, keep: set[int]) -> None:
        """Only the base and the current version are kept (~80 MB for 13M params)."""
        keep_list = sorted(keep)
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM own_model_blobs WHERE NOT (version = ANY(%s))", (keep_list,))
            cur.execute(
                """UPDATE user_entities
                   SET data = jsonb_set(data, '{versions}', coalesce((
                         SELECT jsonb_object_agg(key, value) FROM jsonb_each(data->'versions')
                         WHERE key = ANY(%s)), '{}'::jsonb))
                   WHERE user_id = %s AND entity_name = %s AND entity_id = %s""",
                ([str(v) for v in keep_list], PARTITION, STATE_ENTITY, STATE_ID),
            )
        self.conn.commit()


# ------------------------------------------------------------------ one pass

def check(store: Store) -> bool:
    """Cheap: anything to learn? Also proves the schedule is alive."""
    store.ensure_blobs_table()
    state = store.read_state()
    ready = bool(state.get("base_version") and state.get("current_version"))
    pending = store.count_pending() if ready else 0
    work = ready and (pending > 0 or needs_rebuild(state))
    store.merge_state({"trainer_checked_at": _now()})
    log(f"model={'ready' if ready else 'missing'} pending={pending} rebuild={needs_rebuild(state)} work={work}")
    return work


def run_once(store: Store, *, max_lessons: int = MAX_LESSONS_PER_RUN,
             time_budget_s: float = TIME_BUDGET_S, device: str = "cpu") -> dict:
    store.ensure_blobs_table()
    state = store.read_state()
    base_v, cur_v = state.get("base_version"), state.get("current_version")
    if not base_v or not cur_v:
        store.heartbeat("waiting", message="No model uploaded yet.")
        log("no model uploaded yet")
        return {"status": "waiting"}

    lessons = [l for l in store.lessons() if l.get("id") and str(l.get("chosen") or "").strip()]
    pending = [l for l in lessons if is_pending(l)]
    # The steward's own corrections before automatic ones, oldest first.
    pending.sort(key=lambda l: (l.get("source") == "auto", l.get("created_date") or ""))
    learned = [l for l in lessons if l.get("status") == "learned"]
    rebuild_seq = int(state.get("rebuild_seq") or 0)
    rebuild = needs_rebuild(state)
    if not pending and not rebuild:
        store.heartbeat("idle", version=cur_v, message="Nothing new to learn.")
        log("nothing to learn")
        return {"status": "idle"}

    started = time.monotonic()
    deadline = started + time_budget_s
    store.heartbeat("running", version=cur_v, message="Learning.")

    import learning
    import modeling
    import weights_io

    base, tokenizer_json, special_names = weights_io.read_master(store.read_blob(base_v, "master"), device)
    weights_io.install_tokenizer(tokenizer_json, special_names)
    current = base if cur_v == base_v else weights_io.read_master(store.read_blob(cur_v, "master"), device)[0]
    block = base.cfg.block_size

    def example(lesson):
        return modeling.encode_lesson(
            lesson.get("context") or [], lesson["chosen"], lesson.get("rejected"), block,
        )

    results: dict[str, dict] = {}
    failures: dict[str, str] = {}
    by_id = {l["id"]: l for l in lessons}
    if rebuild:
        todo = [*learned, *pending[:max_lessons]]
        if todo:
            student, losses, epochs = learning.relearn(
                base, [example(l) for l in todo], device, deadline=deadline,
            )
            for lesson, loss in zip(todo, losses):
                results[lesson["id"]] = {"loss_after": round(loss, 4)}
        else:
            student, epochs = learning.freeze(base), 0
        kind = "rebuild"
        log(f"relearned {len(todo)} lessons from the base in {epochs} rounds")
    else:
        student = current
        replay = [example(l) for l in learned]
        for lesson in pending[:max_lessons]:
            if time.monotonic() > deadline:
                break
            try:
                ex = example(lesson)
                student, stats = learning.learn_lesson(student, base, ex, replay, device)
                results[lesson["id"]] = stats
                replay.append(ex)
                log(f"lesson {len(results)}: loss {stats['loss_before']:.2f} -> {stats['loss_after']:.2f} "
                    f"in {stats['steps']} steps")
            except Exception as exc:  # one bad lesson must not sink the run
                failures[lesson["id"]] = str(exc)[:300]
                log(f"a lesson failed: {type(exc).__name__}")
        kind = "learned"

    version = None
    if results or rebuild:
        after = {}
        # Preview "what it says now" for the steward's own corrections; a
        # relearn keeps the previews it already has.
        for lesson_id in ([] if rebuild else results):
            if by_id[lesson_id].get("source") != "auto":
                text, _, _ = modeling.generate_text(
                    student, example(by_id[lesson_id]).prompt_ids, AFTER_REPLY_TOKENS, temperature=0.5,
                )
                after[lesson_id] = text.strip()
        base_header, _ = weights_io.read_inference(store.read_blob(base_v, "inference"))
        inference = weights_io.export_inference(
            student.state_dict(), base_header["config"], base_header["tokenizer"], base_header["special"],
        )
        master = weights_io.export_master(student.state_dict(), base_header["config"], tokenizer_json, special_names)
        version = store.publish(
            state, inference=inference, master=master, kind=kind, lessons=len(results), expect_base=base_v,
        )
        if version is None:
            store.heartbeat("idle", message="A new base model arrived mid-run; learning restarts on it.")
            log("base model changed during the run; results dropped")
            return {"status": "discarded"}
        for lesson_id, stats in results.items():
            store.update_lesson(by_id[lesson_id], {
                "status": "learned",
                "version": version,
                "error": None,
                **stats,
                **({"after_reply": after[lesson_id]} if lesson_id in after else {}),
            })
        if rebuild:
            store.merge_state({"rebuilt_seq": rebuild_seq})
        store.prune({int(base_v), version})

    for lesson_id, error in failures.items():
        lesson = by_id[lesson_id]
        store.update_lesson(lesson, {
            "status": "failed",
            "attempts": int(lesson.get("attempts") or 0) + 1,
            "error": error,
        })

    duration = round(time.monotonic() - started, 1)
    store.heartbeat(
        "ok", version=version or cur_v, learned=len(results), failed=len(failures), duration_s=duration,
        message=f"Learned {len(results)} lesson(s)." if results else "Nothing learned this run.",
    )
    log(f"learned={len(results)} failed={len(failures)} version={version} in {duration}s")
    return {"status": "ok", "version": version, "learned": len(results), "failed": len(failures)}


# ------------------------------------------------------------------ CLI

def connect(url: str):
    import psycopg
    return psycopg.connect(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Learn pending lessons and publish the own model.")
    parser.add_argument("--check", action="store_true", help="only report whether there is work")
    parser.add_argument("--upload", metavar="BUNDLE", help="install an exported anima-model.bin as the new base")
    parser.add_argument("--watch", action="store_true", help="keep running, checking every --interval seconds")
    parser.add_argument("--interval", type=float, default=60.0)
    parser.add_argument("--max-lessons", type=int, default=MAX_LESSONS_PER_RUN)
    parser.add_argument("--time-budget", type=float, default=TIME_BUDGET_S)
    args = parser.parse_args()
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        log("DATABASE_URL is not set")
        return 2
    with connect(url) as conn:
        store = Store(conn)
        if args.upload:
            import weights_io
            with open(args.upload, "rb") as f:
                bundle = weights_io.read_bundle(f.read())
            store.ensure_blobs_table()
            version = store.install_base(bundle["inference"], bundle["master"])
            log(f"installed base model as version {version}; lessons will be relearned on it")
            return 0
        if args.check:
            work = check(store)
            output = os.environ.get("GITHUB_OUTPUT")
            if output:
                with open(output, "a", encoding="utf-8") as f:
                    f.write(f"work={'true' if work else 'false'}\n")
            return 0
        while True:
            try:
                result = run_once(store, max_lessons=args.max_lessons, time_budget_s=args.time_budget)
            except Exception as exc:
                conn.rollback()
                store.heartbeat("error", message=f"{type(exc).__name__}: {str(exc)[:200]}")
                log(f"run failed: {type(exc).__name__}")
                if not args.watch:
                    raise
                result = {"status": "error"}
            if not args.watch:
                return 0
            if result.get("status") in ("idle", "waiting", "error"):
                time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
