# Tests for the Ollama-style serving layer: the sampler (sampling.py), the
# system-first prompt fit, Modelfile defaults, and the native /api routes the
# api-server's Ollama adapter calls.
#
# Run from the repo root:
#   python -m unittest discover -s server/tests -v

import json
import os
import unittest

import torch

from support import TMP  # noqa: F401  (sets ANIMA_* before server imports)
import modelfile  # noqa: E402
import modeling  # noqa: E402
import sampling  # noqa: E402
import server  # noqa: E402  (loads the base checkpoint on import)
import sft  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PROTECTED = None


def _protected():
    global PROTECTED
    if PROTECTED is None:
        PROTECTED = sampling.protected_ids()
    return PROTECTED


def _pick(logits, history=(), **options):
    opts = sampling.merge_options(sampling.SamplingOptions(repeat_penalty=1.0, top_p=1.0, top_k=0), options)
    return sampling.next_token(
        torch.tensor(logits, dtype=torch.float), list(history), opts, protected=set(),
    )


class SamplerTests(unittest.TestCase):
    def test_zero_temperature_is_greedy(self):
        self.assertEqual(_pick([0.1, 3.0, 0.2], temperature=0), 1)

    def test_top_p_keeps_only_the_nucleus(self):
        # p ≈ [0.88, 0.12, 0.00…]: top_p 0.5 leaves only the first token.
        logits = [4.0, 2.0, -6.0, -6.0]
        picks = {_pick(logits, temperature=1.0, top_p=0.5) for _ in range(40)}
        self.assertEqual(picks, {0})

    def test_min_p_drops_tokens_far_below_the_best(self):
        logits = [3.0, 2.9, -3.0, -3.0]
        picks = {_pick(logits, temperature=1.0, min_p=0.5) for _ in range(60)}
        self.assertTrue(picks <= {0, 1})

    def test_repeat_penalty_steers_away_from_recent_tokens(self):
        logits = [2.0, 1.9]
        self.assertEqual(_pick(logits, temperature=0), 0)
        self.assertEqual(_pick(logits, history=[0], temperature=0, repeat_penalty=1.5), 1)
        # Outside repeat_last_n the earlier token is not penalised.
        self.assertEqual(
            _pick(logits, history=[0, 5, 5], temperature=0, repeat_penalty=1.5, repeat_last_n=2), 0,
        )

    def test_frequency_penalty_grows_with_each_repeat(self):
        logits = [2.0, 1.5]
        self.assertEqual(_pick(logits, history=[0], temperature=0, frequency_penalty=0.3), 0)
        self.assertEqual(_pick(logits, history=[0, 0], temperature=0, frequency_penalty=0.3), 1)

    def test_turn_markers_are_never_penalised(self):
        eot = sft.eot_id
        logits = torch.full((sft.tok.get_vocab_size(),), -5.0)
        logits[eot] = 2.0
        opts = sampling.SamplingOptions(temperature=0, repeat_penalty=2.0)
        token = sampling.next_token(logits, [eot] * 10, opts, protected=_protected())
        self.assertEqual(token, eot)

    def test_merge_options_clamps_and_ignores_junk(self):
        opts = sampling.merge_options(sampling.SamplingOptions(), {
            "temperature": 9, "top_p": "nope", "num_predict": -1, "stop": ["\n\n", "", "\n\n"],
            "seed": -1, "mirostat": 2, "repeat_penalty": 0,
        })
        self.assertEqual(opts.temperature, 2.0)
        self.assertEqual(opts.top_p, sampling.SamplingOptions().top_p)
        self.assertEqual(opts.num_predict, sampling.MAX_NEW_TOKENS)
        self.assertEqual(opts.stop, ("\n\n",))
        self.assertIsNone(opts.seed)
        self.assertEqual(opts.repeat_penalty, 1.0)

    def test_seed_reproduces_a_reply_without_the_global_rng(self):
        model = server._serving_model()
        prompt = modeling.fit_chat_prompt([{"role": "user", "content": "Hello"}], 40).ids
        opts = sampling.SamplingOptions(temperature=1.2, seed=11, num_predict=16)
        first, _ = sampling.generate(model, prompt, opts)
        torch.manual_seed(999)
        second, _ = sampling.generate(model, prompt, opts)
        self.assertEqual(first, second)

    def test_stop_string_ends_the_reply_and_is_never_sent(self):
        model = server._serving_model()
        prompt = modeling.fit_chat_prompt([{"role": "user", "content": "Hello"}], 40).ids
        base = sampling.SamplingOptions(temperature=0, num_predict=24, repeat_penalty=1.0)
        text, _ = sampling.generate(model, prompt, base)
        words = text.split()
        self.assertGreater(len(words), 2, text)
        stop = words[2]
        pieces = list(sampling.reply_pieces(model, prompt, sampling.merge_options(base, {"stop": [stop]})))
        joined = "".join(pieces)
        self.assertNotIn(stop, joined)
        self.assertTrue(text.startswith(joined.rstrip()), (text, joined))

    def test_num_ctx_shrinks_the_window(self):
        model = server._serving_model()
        opts = sampling.merge_options(sampling.SamplingOptions(), {"num_ctx": 8192})
        self.assertEqual(sampling.context_window(model, opts), model.cfg.block_size)
        opts = sampling.merge_options(sampling.SamplingOptions(), {"num_ctx": 32})
        self.assertEqual(sampling.context_window(model, opts), 32)


class PromptFitTests(unittest.TestCase):
    def test_system_prompt_outranks_older_history(self):
        messages = [
            {"role": "system", "content": "Be warm."},
            *[{"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i} " * 6} for i in range(30)],
            {"role": "user", "content": "the newest question"},
        ]
        fit = modeling.fit_chat_prompt(messages, 40)
        text = sft.tok.decode(fit.ids)
        self.assertLessEqual(len(fit.ids), 40)
        self.assertIn("Be warm.", text)
        self.assertIn("newest question", text)
        self.assertTrue(fit.system_kept)
        self.assertTrue(fit.truncated)
        self.assertGreater(fit.messages_dropped, 0)
        # System first, then history in order, newest turn last.
        self.assertLess(text.index("Be warm."), text.index("newest question"))
        self.assertEqual(fit.ids[-1], sft.role_ids["anima"])

    def test_a_system_prompt_too_big_for_the_window_is_left_out_whole(self):
        fit = modeling.fit_chat_prompt(
            [{"role": "system", "content": "persona " * 4000}, {"role": "user", "content": "Hi"}], 40,
        )
        self.assertNotIn("persona", sft.tok.decode(fit.ids))
        self.assertFalse(fit.system_kept)


class ModelfileTests(unittest.TestCase):
    def test_parses_ollama_instructions(self):
        mf = modelfile.parse('''
# comment
FROM ./ckpt.pt
PARAMETER temperature 0.6
PARAMETER stop "<|user|>"
PARAMETER stop "\\n\\n"
PARAMETER num_ctx 64
SYSTEM """You are Anima.
Stay warm."""
MESSAGE user Hello
MESSAGE assistant """Hi, I missed you."""
''')
        self.assertEqual(mf.base, "./ckpt.pt")
        self.assertEqual(mf.parameters["temperature"], 0.6)
        self.assertEqual(mf.parameters["num_ctx"], 64)
        self.assertEqual(len(mf.parameters["stop"]), 2)
        self.assertEqual(mf.system, "You are Anima.\nStay warm.")
        self.assertEqual(mf.messages, [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi, I missed you."},
        ])
        opts = sampling.merge_options(sampling.SamplingOptions(), mf.parameters)
        self.assertEqual(opts.temperature, 0.6)

    def test_rejects_unknown_instructions_and_roles(self):
        with self.assertRaises(modelfile.ModelfileError):
            modelfile.parse("PARAMTER temperature 1")
        with self.assertRaises(modelfile.ModelfileError):
            modelfile.parse("MESSAGE narrator hi")
        with self.assertRaises(modelfile.ModelfileError):
            modelfile.parse('SYSTEM """never closed')

    def test_off_serves_built_in_defaults(self):
        self.assertEqual(modelfile.load("off").parameters, {})

    def test_shipped_modelfile_parses(self):
        mf = modelfile.load(str(modelfile.DEFAULT_PATH))
        self.assertIn("min_p", mf.parameters)

    def test_modelfile_system_applies_only_without_a_request_system(self):
        saved = server.modelfile
        server.modelfile = modelfile.parse('SYSTEM "Be kind."\nMESSAGE assistant "Welcome back."')
        try:
            msgs = server._prepare_messages([{"role": "user", "content": "Hi"}])
            self.assertEqual(msgs[0], {"role": "system", "content": "Be kind."})
            self.assertEqual(msgs[1]["role"], "anima")
            own = server._prepare_messages([
                {"role": "system", "content": "Mine."}, {"role": "user", "content": "Hi"},
            ])
            self.assertEqual(own[0]["content"], "Mine.")
            self.assertNotIn("Be kind.", [m["content"] for m in own])
        finally:
            server.modelfile = saved


def _ndjson(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


class OllamaApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)

    def test_chat_non_stream_matches_ollama(self):
        r = self.client.post("/api/chat", json={
            "model": "anima-own",
            "messages": [{"role": "user", "content": "Hello"}],
            "stream": False,
            "options": {"temperature": 0, "num_predict": 12},
        })
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["done"])
        self.assertIn(body["done_reason"], ("stop", "length"))
        self.assertEqual(body["message"]["role"], "assistant")
        self.assertIsInstance(body["message"]["content"], str)
        self.assertGreater(body["prompt_eval_count"], 0)
        self.assertLessEqual(body["eval_count"], 12)
        self.assertGreaterEqual(body["total_duration"], body["eval_duration"])

    def test_chat_stream_is_ndjson_and_matches_non_stream(self):
        body = {
            "messages": [{"role": "user", "content": "Tell me about your day."}],
            "options": {"temperature": 0.9, "seed": 5, "num_predict": 30},
        }
        whole = self.client.post("/api/chat", json={**body, "stream": False}).json()
        r = self.client.post("/api/chat", json=body)  # Ollama streams by default
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/x-ndjson", r.headers["content-type"])
        events = _ndjson(r.text)
        self.assertTrue(all(not e["done"] for e in events[:-1]))
        self.assertTrue(events[-1]["done"])
        streamed = "".join(e["message"]["content"] for e in events)
        self.assertEqual(streamed, whole["message"]["content"])
        self.assertEqual(events[-1]["done_reason"], whole["done_reason"])

    def test_accepts_what_the_api_server_adapter_sends(self):
        # ollamaChat.ts: Qwen-tuned options, num_ctx 8192, keep_alive, images.
        r = self.client.post("/api/chat", json={
            "model": "anima-chat",
            "messages": [
                {"role": "system", "content": "You are Serenity. " * 2000},
                {"role": "user", "content": "Hi", "images": ["AAAA"]},
            ],
            "stream": True,
            "keep_alive": "30m",
            "options": {
                "top_p": 0.8, "top_k": 20, "repeat_penalty": 1.05,
                "num_ctx": 8192, "num_predict": 200, "temperature": 0.65,
            },
        })
        self.assertEqual(r.status_code, 200, r.text)
        events = _ndjson(r.text)
        self.assertTrue(events[-1]["done"])
        self.assertEqual(events[-1]["model"], "anima-chat")
        self.assertLessEqual(events[-1]["prompt_eval_count"], 64)

    def test_empty_requests_load_and_warm_the_model(self):
        chat = self.client.post("/api/chat", json={"model": "anima-own", "messages": []}).json()
        self.assertEqual(chat["done_reason"], "load")
        # The api-server's warm-up: empty prompt, one token, stream false.
        gen = self.client.post("/api/generate", json={
            "model": "anima-chat", "prompt": "", "stream": False,
            "options": {"num_ctx": 8192, "num_predict": 1},
        }).json()
        self.assertEqual(gen["done_reason"], "load")
        self.assertEqual(gen["response"], "")
        self.assertIsNotNone(self.client.get("/health").json()["warm_ms"])

    def test_generate_with_system_and_prompt(self):
        r = self.client.post("/api/generate", json={
            "prompt": "Hello", "system": "Be warm.", "stream": False,
            "options": {"temperature": 0, "num_predict": 8},
        })
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsInstance(r.json()["response"], str)
        self.assertTrue(r.json()["done"])

    def test_model_listing_and_show(self):
        os.environ["ANIMA_MODEL_ALIASES"] = "anima-chat"
        try:
            tags = self.client.get("/api/tags").json()["models"]
            names = [m["name"] for m in tags]
            self.assertEqual(names, ["anima-own:latest", "anima-chat:latest"])
            ps = self.client.get("/api/ps").json()["models"]
            self.assertEqual(ps[0]["expires_at"], server.NEVER_EXPIRES)
        finally:
            os.environ.pop("ANIMA_MODEL_ALIASES", None)
        show = self.client.post("/api/show", json={"model": "anima-own"}).json()
        self.assertEqual(show["model_info"]["anima-gpt.context_length"], 64)
        self.assertIn("temperature", show["parameters"])
        self.assertTrue(self.client.get("/api/version").json()["version"].startswith("anima-own-"))

    def test_rejects_messages_with_no_text(self):
        r = self.client.post("/api/chat", json={
            "messages": [{"role": "user", "content": ""}], "stream": False,
        })
        self.assertEqual(r.status_code, 400)

    def test_bearer_token_guards_the_api_routes(self):
        os.environ["ANIMA_SERVER_TOKEN"] = "sekret"
        try:
            self.assertEqual(self.client.get("/api/tags").status_code, 401)
            self.assertEqual(self.client.post("/api/chat", json={"messages": []}).status_code, 401)
            ok = self.client.get("/api/tags", headers={"Authorization": "Bearer sekret"})
            self.assertEqual(ok.status_code, 200)
        finally:
            os.environ.pop("ANIMA_SERVER_TOKEN", None)

    def test_oversized_bodies_are_refused(self):
        huge = {"messages": [{"role": "user", "content": "x" * (server.MAX_BODY_BYTES + 1)}]}
        self.assertEqual(self.client.post("/api/chat", json=huge).status_code, 413)


class OpenAiSamplingTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)

    def test_openai_seed_and_stop_are_honoured(self):
        body = {
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 1.1, "seed": 3, "max_tokens": 20,
        }
        a = self.client.post("/v1/chat/completions", json=body).json()
        b = self.client.post("/v1/chat/completions", json=body).json()
        self.assertEqual(a["choices"][0]["message"]["content"], b["choices"][0]["message"]["content"])
        r = self.client.post("/v1/chat/completions", json={**body, "stream": True})
        chunks = [json.loads(line[6:]) for line in r.text.splitlines()
                  if line.startswith("data: ") and line != "data: [DONE]"]
        streamed = "".join(c["choices"][0]["delta"].get("content", "") for c in chunks)
        self.assertEqual(streamed, a["choices"][0]["message"]["content"])


if __name__ == "__main__":
    unittest.main()
