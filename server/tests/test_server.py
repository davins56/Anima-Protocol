# Tests for the own-model server: prompt fitting, OpenAI-compatible chat
# (streaming and not), and learning from taught lessons.
#
# Run from the repo root:
#   pip install -r server/requirements-test.txt
#   python -m unittest discover -s server/tests -v
#
# A tiny tokenizer and a randomly initialised 1-layer GPT are built in a temp
# dir, so no trained checkpoint is needed and the suite runs in seconds on CPU.

import json
import os
import tempfile
import threading
import unittest

import torch

from support import BASE, TMP, TOK_DIR, FastLearning, build_checkpoint  # noqa: F401  (sets ANIMA_* first)
import learning  # noqa: E402
import modeling  # noqa: E402
import server  # noqa: E402  (loads the base checkpoint on import)
import sft  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class ModelingTests(unittest.TestCase):
    def test_message_text_accepts_openai_shapes(self):
        self.assertEqual(modeling.message_text("hi"), "hi")
        self.assertEqual(modeling.message_text(None), "")
        self.assertEqual(
            modeling.message_text([{"type": "text", "text": "a"}, {"type": "image_url"}, "b"]),
            "ab",
        )

    def test_roles_map_onto_the_sft_layout(self):
        self.assertEqual(modeling.normalize_role("assistant"), "anima")
        self.assertEqual(modeling.normalize_role("developer"), "system")
        self.assertEqual(modeling.normalize_role("tool"), "user")

    def test_fit_prompt_stays_inside_budget_and_opens_anima_turn(self):
        messages = [
            {"role": "system", "content": "persona " * 5000},
            *[{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i} " * 8} for i in range(40)],
            {"role": "user", "content": "the newest question"},
        ]
        ids = modeling.fit_prompt(messages, 48)
        self.assertLessEqual(len(ids), 48)
        self.assertEqual(ids[0], sft.eot_id)
        self.assertEqual(ids[-1], sft.role_ids["anima"])
        self.assertIn("newest question", sft.tok.decode(ids))
        self.assertNotIn("persona", sft.tok.decode(ids))

    def test_fit_prompt_keeps_the_tail_of_a_huge_last_message(self):
        ids = modeling.fit_prompt([{"role": "user", "content": "x " * 3000 + "final words"}], 32)
        self.assertLessEqual(len(ids), 32)
        self.assertTrue(sft.tok.decode(ids).rstrip().endswith("final words"))

    def test_fit_prompt_keeps_a_short_system_note_when_it_fits(self):
        ids = modeling.fit_prompt(
            [{"role": "system", "content": "Be warm."}, {"role": "user", "content": "Hi"}], 60,
        )
        self.assertIn("Be warm.", sft.tok.decode(ids))

    def test_lesson_targets_only_the_corrected_reply(self):
        ex = modeling.encode_lesson(
            [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "old reply"}],
            "I missed you.", "no", 64,
        )
        predicted = [t for t in ex.sft_targets if t != -100]
        self.assertEqual(sft.tok.decode(predicted[:-1]), "I missed you.")
        self.assertEqual(predicted[-1], sft.eot_id)
        self.assertEqual(ex.chosen_seq[1], ex.rejected_seq[1])
        self.assertIsNone(modeling.encode_lesson([], "same", " same ", 64).rejected_seq)

    def test_text_deltas_never_split_characters(self):
        text = "Café ✨ lights"
        ids = sft.tok.encode(text).ids
        deltas = list(modeling.iter_text_deltas(iter(ids)))
        self.assertEqual("".join(deltas), text)
        self.assertFalse(any("�" in d for d in deltas))


class ChatApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)

    def test_non_stream_chat_accepts_what_the_app_sends(self):
        r = self.client.post("/v1/chat/completions", json={
            "model": "anima-own",
            "messages": [
                {"role": "system", "content": "You are Serenity. " * 3000},
                {"role": "assistant", "content": None, "tool_calls": []},
                {"role": "user", "content": [{"type": "text", "text": "Hello"}]},
            ],
            "max_tokens": 4096,
            "temperature": 0.7,
            "keep_alive": "30m",
        })
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["object"], "chat.completion")
        self.assertEqual(body["model"], "anima-own")
        self.assertIn(body["choices"][0]["finish_reason"], ("stop", "length"))
        self.assertIsInstance(body["choices"][0]["message"]["content"], str)
        self.assertLessEqual(body["usage"]["prompt_tokens"], 64)

    def test_stream_chat_speaks_openai_sse(self):
        with self.client.stream("POST", "/v1/chat/completions", json={
            "messages": [{"role": "user", "content": "Hello"}],
            "stream": True,
            "max_tokens": 12,
        }) as r:
            self.assertEqual(r.status_code, 200)
            self.assertIn("text/event-stream", r.headers["content-type"])
            lines = [line for line in r.iter_lines() if line.startswith("data: ")]
        self.assertEqual(lines[-1], "data: [DONE]")
        chunks = [json.loads(line[6:]) for line in lines[:-1]]
        self.assertEqual(chunks[0]["choices"][0]["delta"]["role"], "assistant")
        self.assertIn(chunks[-1]["choices"][0]["finish_reason"], ("stop", "length"))
        self.assertTrue(all(c["object"] == "chat.completion.chunk" for c in chunks))

    def test_rejects_empty_and_oversized_requests(self):
        self.assertEqual(self.client.post("/v1/chat/completions", json={"messages": []}).status_code, 422)
        huge = {"messages": [{"role": "user", "content": "x" * (server.MAX_BODY_BYTES + 1)}]}
        self.assertEqual(self.client.post("/v1/chat/completions", json=huge).status_code, 413)

    def test_bearer_token_guards_every_v1_route(self):
        os.environ["ANIMA_SERVER_TOKEN"] = "sekret"
        try:
            self.assertEqual(self.client.get("/v1/models").status_code, 401)
            self.assertEqual(self.client.get("/v1/lessons/status").status_code, 401)
            ok = self.client.get("/v1/models", headers={"Authorization": "Bearer sekret"})
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(ok.json()["data"][0]["id"], "anima-own")
            self.assertEqual(self.client.get("/health").status_code, 200)
        finally:
            os.environ.pop("ANIMA_SERVER_TOKEN", None)

    def test_refuses_public_bind_without_token(self):
        with self.assertRaises(SystemExit):
            server.resolve_host("0.0.0.0")
        self.assertEqual(server.resolve_host("127.0.0.1"), "127.0.0.1")

    def test_learning_can_be_switched_off(self):
        os.environ["ANIMA_LEARNING"] = "off"
        try:
            r = self.client.post("/v1/lessons", json={"chosen": "hi"})
            self.assertEqual(r.status_code, 403)
        finally:
            os.environ.pop("ANIMA_LEARNING", None)


class LessonApiTests(FastLearning, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(server.app)

    def test_teach_learns_the_correction_and_reports_it(self):
        context = [{"role": "user", "content": "How are you feeling today?"}]
        before = self.client.get("/v1/lessons/status").json()
        r = self.client.post("/v1/lessons", json={
            "id": "lesson-api-1",
            "messages": context,
            "chosen": "I missed our talks.",
            "rejected": "stars stars stars",
            "wait": 30,
        })
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["status"], "done")
        result = body["result"]
        self.assertLess(result["loss_after"], result["loss_before"])
        self.assertEqual(result["after_reply"], "I missed our talks.")
        self.assertEqual(body["version"], before["version"] + 1)

        status = self.client.get("/v1/lessons/status").json()
        self.assertIn("lesson-api-1", status["learned_ids"])
        self.assertTrue(status["can_rollback"])

        # The served model now answers the same moment with the correction.
        reply = self.client.post("/v1/chat/completions", json={
            "messages": context, "temperature": 0, "max_tokens": 20,
        }).json()["choices"][0]["message"]["content"]
        self.assertEqual(reply, "I missed our talks.")

    def test_teach_rejects_a_lesson_without_a_better_reply(self):
        r = self.client.post("/v1/lessons", json={"messages": [], "chosen": "   "})
        self.assertEqual(r.status_code, 400)

    def test_forget_removes_from_the_store(self):
        self.client.post("/v1/lessons", json={"id": "to-forget", "chosen": "Hello there.", "wait": 30})
        r = self.client.delete("/v1/lessons/to-forget")
        self.assertEqual(r.json(), {"removed": True, "was_learned": True})
        ids = [l["id"] for l in self.client.get("/v1/lessons").json()["lessons"]]
        self.assertNotIn("to-forget", ids)


class AdaptiveLearningTests(unittest.TestCase):
    """Default settings: a model too small for LESSON_LR still learns, because
    slow progress doubles the step size (the path a resized model takes)."""

    def test_a_slow_learner_escalates_until_the_lesson_sticks(self):
        live = learning.LiveModel(BASE, tempfile.mkdtemp(dir=TMP), device="cpu")
        live.put_lesson({
            "id": "slow",
            "messages": [{"role": "user", "content": "How are you feeling today?"}],
            "chosen": "I missed our talks.",
        })
        job = live.wait(live.submit("learn", "slow"), 120)
        self.assertEqual(job["status"], "done", job.get("error"))
        result = job["result"]
        self.assertLessEqual(result["loss_after"], learning.LESSON_TARGET_LOSS)
        self.assertLessEqual(result["steps"], learning.LESSON_MAX_STEPS)
        self.assertEqual(result["after_reply"], "I missed our talks.")


class LiveModelTests(FastLearning, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.dir = tempfile.mkdtemp(dir=TMP)

    def _live(self, base=BASE):
        return learning.LiveModel(base, self.dir, device="cpu")

    def _learn(self, live, lesson):
        live.put_lesson(lesson)
        job = live.wait(live.submit("learn", lesson["id"]), 60)
        self.assertEqual(job["status"], "done", job.get("error"))
        return job["result"]

    def test_learned_versions_survive_a_restart(self):
        live = self._live()
        self._learn(live, {"id": "a", "messages": [{"role": "user", "content": "Hi"}], "chosen": "Hello there."})
        again = self._live()
        self.assertEqual(again.version, live.version)
        self.assertIn("a", again.learned)
        for key, value in live.model.state_dict().items():
            self.assertTrue(torch.equal(value, again.model.state_dict()[key]), key)

    def test_rollback_restores_the_previous_weights(self):
        live = self._live()
        self._learn(live, {"id": "a", "chosen": "Hello there."})
        v1 = live.version
        v1_weights = {k: v.clone() for k, v in live.model.state_dict().items()}
        self._learn(live, {"id": "b", "chosen": "Tell me about your day."})
        job = live.wait(live.submit("rollback"), 30)
        self.assertEqual(job["status"], "done")
        self.assertEqual(live.version, v1)
        self.assertEqual(set(live.learned), {"a"})
        for key, value in live.model.state_dict().items():
            self.assertTrue(torch.equal(value, v1_weights[key]), key)
        live.wait(live.submit("rollback"), 30)
        self.assertEqual(live.version, 0)
        self.assertIs(live.model, live.base)
        self.assertFalse(live.can_rollback())

    def test_sync_relearns_everything_from_base(self):
        live = self._live()
        live.replace_lessons([
            {"id": "x", "messages": [{"role": "user", "content": "Hi"}], "chosen": "Hello there."},
            {"id": "y", "messages": [{"role": "user", "content": "Day?"}], "chosen": "Soft rain."},
        ])
        job = live.wait(live.submit("rebuild"), 120)
        self.assertEqual(job["status"], "done", job.get("error"))
        self.assertEqual(set(live.learned), {"x", "y"})
        self.assertEqual(job["result"]["lessons"], 2)

    def test_a_new_base_relearns_stored_lessons_on_startup(self):
        live = self._live()
        self._learn(live, {"id": "keep", "chosen": "Hello there."})
        other_base = os.path.join(self.dir, "other-base.pt")
        build_checkpoint(other_base, sft.tok.get_vocab_size(), seed=1)
        fresh = self._live(base=other_base)
        self.assertEqual(fresh.version, 0)
        deadline = threading.Event()
        for _ in range(240):
            if "keep" in fresh.learned:
                break
            deadline.wait(0.5)
        self.assertIn("keep", fresh.learned)

    def test_serving_never_sees_the_weights_being_trained(self):
        live = self._live()
        serving = live.model
        before = {k: v.clone() for k, v in serving.state_dict().items()}
        self._learn(live, {"id": "iso", "chosen": "Hello there."})
        self.assertIsNot(live.model, serving)
        for key, value in serving.state_dict().items():
            self.assertTrue(torch.equal(value, before[key]), key)


if __name__ == "__main__":
    unittest.main()
