# Tests for the browser weight format and the background trainer.
#
# The trainer tests need Postgres (DATABASE_URL) and psycopg; they run in a
# throwaway schema and are skipped when either is missing.

import json
import os
import sys
import unittest
import uuid
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import support as fixtures  # noqa: E402  (builds the tiny tokenizer + checkpoint)
import learning  # noqa: E402
import modeling  # noqa: E402
import sft  # noqa: E402
import trainer  # noqa: E402
import weights_io  # noqa: E402

TOKENIZER_JSON = Path(fixtures.TOK_DIR, "tokenizer.json").read_text(encoding="utf-8")
META = json.loads(Path(fixtures.TOK_DIR, "meta.json").read_text(encoding="utf-8"))


def tiny_bundle(seed: int = 0) -> tuple[bytes, bytes, dict]:
    torch.manual_seed(seed)
    ckpt = torch.load(fixtures.BASE, map_location="cpu", weights_only=True)
    cfg = weights_io.model_config(ckpt["cfg"])
    inference = weights_io.export_inference(
        ckpt["model"], cfg, weights_io.tokenizer_payload(TOKENIZER_JSON),
        weights_io.special_ids(sft.tok, META),
    )
    master = weights_io.export_master(ckpt["model"], cfg, TOKENIZER_JSON, META["special"])
    return inference, master, ckpt


class WeightFormatTests(unittest.TestCase):
    def test_inference_blob_round_trips_within_int8_precision(self):
        inference, _, ckpt = tiny_bundle()
        header, state = weights_io.read_inference(inference)
        self.assertEqual(header["format"], "anima-web-1")
        self.assertEqual(header["config"]["block_size"], 64)
        self.assertEqual(header["special"]["anima"], sft.role_ids["anima"])
        for name, original in weights_io.serving_state(ckpt["model"]).items():
            restored = state[name]
            self.assertEqual(tuple(restored.shape), tuple(original.shape), name)
            if original.dim() == 2:
                row_max = original.abs().amax(dim=1, keepdim=True)
                self.assertTrue(torch.all((restored - original).abs() <= row_max / 127 * 0.5 + 1e-7), name)
            else:
                self.assertTrue(torch.equal(restored, original.float()), name)

    def test_quantized_model_keeps_its_predictions(self):
        inference, _, ckpt = tiny_bundle()
        header, state = weights_io.read_inference(inference)
        quantized = weights_io.model_from_state(state, header["config"])
        full = weights_io.model_from_state(
            {k: v.float() for k, v in weights_io.serving_state(ckpt["model"]).items()}, header["config"],
        )
        ids = torch.tensor([modeling.fit_prompt([{"role": "user", "content": "Hello there"}], 48)])
        with torch.no_grad():
            a, _ = quantized(ids)
            b, _ = full(ids)
        self.assertLess(float((a - b).abs().max()), 0.05)

    def test_master_blob_carries_weights_and_tokenizer(self):
        _, master, ckpt = tiny_bundle()
        model, tokenizer_json, special_names = weights_io.read_master(master)
        self.assertEqual(tokenizer_json, TOKENIZER_JSON)
        self.assertEqual(special_names, META["special"])
        for name, value in weights_io.serving_state(ckpt["model"]).items():
            self.assertTrue(torch.allclose(model.state_dict()[name], value.half().float()), name)

    def test_bundle_round_trip_and_corruption(self):
        inference, master, ckpt = tiny_bundle()
        bundle = weights_io.export_bundle(inference, master, ckpt["cfg"])
        parts = weights_io.read_bundle(bundle)
        self.assertEqual(parts["inference"], inference)
        self.assertEqual(parts["master"], master)
        broken = bytearray(bundle)
        broken[-1] ^= 0xFF
        with self.assertRaises(ValueError):
            weights_io.read_bundle(bytes(broken))


def _database_url():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return None
    try:
        import psycopg  # noqa: F401
    except ImportError:
        return None
    return url


@unittest.skipUnless(_database_url(), "needs DATABASE_URL and psycopg")
class TrainerTests(fixtures.FastLearning, unittest.TestCase):
    def setUp(self):
        super().setUp()
        import psycopg
        self.schema = f"trainer_test_{uuid.uuid4().hex[:10]}"
        self.conn = psycopg.connect(_database_url())
        with self.conn.cursor() as cur:
            cur.execute(f'CREATE SCHEMA "{self.schema}"')
            cur.execute(f'SET search_path TO "{self.schema}"')
            cur.execute("""CREATE TABLE user_entities (
                id serial PRIMARY KEY,
                user_id text NOT NULL,
                entity_name text NOT NULL,
                entity_id text NOT NULL,
                data jsonb NOT NULL,
                created_at timestamp DEFAULT now() NOT NULL,
                updated_at timestamp DEFAULT now() NOT NULL)""")
            cur.execute("CREATE UNIQUE INDEX ON user_entities (user_id, entity_name, entity_id)")
        self.conn.commit()
        self.store = trainer.Store(self.conn)
        self.store.ensure_blobs_table()

    def tearDown(self):
        self.conn.rollback()
        with self.conn.cursor() as cur:
            cur.execute(f'DROP SCHEMA "{self.schema}" CASCADE')
        self.conn.commit()
        self.conn.close()
        # install_tokenizer swapped sft's globals; put the fixture tokenizer back.
        sft.tok = None
        sft.init_tokenizer(fixtures.TOK_DIR)
        super().tearDown()

    def add_lesson(self, lesson_id, chosen, *, source="manual", context=None, rejected="stars stars"):
        lesson = {
            "id": lesson_id,
            "context": context if context is not None else [{"role": "user", "content": "How are you feeling today?"}],
            "chosen": chosen,
            "rejected": rejected,
            "source": source,
            "status": "saved",
            "created_date": f"2026-09-27T10:00:{len(lesson_id):02d}Z",
            "updated_date": "2026-09-27T10:00:00Z",
        }
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO user_entities (user_id, entity_name, entity_id, data) VALUES (%s, %s, %s, %s::jsonb)",
                (trainer.PARTITION, trainer.LESSON_ENTITY, lesson_id, json.dumps(lesson)),
            )
        self.conn.commit()
        return lesson

    def lesson(self, lesson_id):
        return next(l for l in self.store.lessons() if l["id"] == lesson_id)

    def test_waits_until_a_model_is_uploaded(self):
        self.assertEqual(trainer.run_once(self.store)["status"], "waiting")
        self.assertFalse(trainer.check(self.store))
        self.assertEqual(self.store.read_state()["trainer"]["status"], "waiting")

    def test_learns_pending_lessons_and_publishes_a_version_browsers_can_run(self):
        inference, master, _ = tiny_bundle()
        base_v = self.store.install_base(inference, master)
        self.add_lesson("manual-1", "I missed our talks.")
        self.add_lesson("auto-1", "Tell me about your day.", source="auto",
                        context=[{"role": "user", "content": "Hi"}])
        self.assertTrue(trainer.check(self.store))

        result = trainer.run_once(self.store)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["learned"], 2)
        state = self.store.read_state()
        new_v = state["current_version"]
        self.assertGreater(new_v, base_v)
        self.assertEqual(state["base_version"], base_v)
        self.assertEqual(sorted(state["versions"]), sorted([str(base_v), str(new_v)]))
        self.assertEqual(state["versions"][str(new_v)]["kind"], "learned")
        self.assertEqual(state["trainer"]["status"], "ok")

        manual = self.lesson("manual-1")
        self.assertEqual(manual["status"], "learned")
        self.assertEqual(manual["version"], new_v)
        self.assertLess(manual["loss_after"], manual["loss_before"])
        self.assertEqual(manual["after_reply"], "I missed our talks.")
        self.assertNotIn("after_reply", self.lesson("auto-1"))

        # The published browser weights answer the lesson's moment with the correction.
        blob = self.store.read_blob(new_v, "inference")
        self.assertEqual(weights_io.sha256(blob), state["versions"][str(new_v)]["inference"]["sha256"])
        header, weights = weights_io.read_inference(blob)
        model = weights_io.model_from_state(weights, header["config"])
        prompt = modeling.fit_prompt([{"role": "user", "content": "How are you feeling today?"}], 48)
        text, _, _ = modeling.generate_text(model, prompt, 20, temperature=1e-5)
        self.assertEqual(text, "I missed our talks.")
        self.assertFalse(trainer.check(self.store))

    def test_relearns_from_the_base_when_asked(self):
        inference, master, _ = tiny_bundle()
        base_v = self.store.install_base(inference, master)
        self.add_lesson("keep", "Hello there.")
        trainer.run_once(self.store)
        self.store.merge_state({"rebuild_seq": 1})
        self.assertTrue(trainer.check(self.store))
        result = trainer.run_once(self.store)
        self.assertEqual(result["status"], "ok")
        state = self.store.read_state()
        self.assertEqual(state["rebuilt_seq"], 1)
        self.assertEqual(state["versions"][str(state["current_version"])]["kind"], "rebuild")
        self.assertEqual(sorted(state["versions"]), sorted([str(base_v), str(state["current_version"])]))
        self.assertFalse(trainer.check(self.store))

    def test_a_new_base_requeues_learned_lessons(self):
        inference, master, _ = tiny_bundle()
        self.store.install_base(inference, master)
        self.add_lesson("again", "Hello there.")
        trainer.run_once(self.store)
        self.assertEqual(self.lesson("again")["status"], "learned")
        new_base = self.store.install_base(*tiny_bundle(seed=1)[:2])
        self.assertEqual(self.lesson("again")["status"], "saved")
        state = self.store.read_state()
        self.assertEqual((state["base_version"], state["current_version"]), (new_base, new_base))
        self.assertEqual(list(state["versions"]), [str(new_base)])

    def test_never_overwrites_a_lesson_edited_mid_run(self):
        inference, master, _ = tiny_bundle()
        self.store.install_base(inference, master)
        stale = self.add_lesson("edited", "Hello there.")
        with self.conn.cursor() as cur:
            cur.execute(
                """UPDATE user_entities SET data = data || '{"chosen": "Soft rain.", "updated_date": "later"}'::jsonb
                   WHERE entity_id = 'edited'""")
        self.conn.commit()
        self.assertFalse(self.store.update_lesson(stale, {"status": "learned"}))
        self.assertEqual(self.lesson("edited")["status"], "saved")

    def test_drops_its_work_when_the_base_changes_mid_run(self):
        inference, master, _ = tiny_bundle()
        base_v = self.store.install_base(inference, master)
        state = self.store.read_state()
        self.assertIsNone(self.store.publish(
            state, inference=inference, master=master, kind="learned", lessons=0, expect_base=base_v + 99,
        ))
        with self.conn.cursor() as cur:
            cur.execute("SELECT DISTINCT version FROM own_model_blobs")
            self.assertEqual([r[0] for r in cur.fetchall()], [base_v])
        self.conn.commit()


if __name__ == "__main__":
    unittest.main()
