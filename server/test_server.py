#!/usr/bin/env python3
"""server.py accepts the chat requests the api-server sends, streaming included.

Builds a tiny random-weight checkpoint and tokenizer in a temp dir, so it runs
without a trained model:  python3 server/test_server.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HAVE_DEPS = all(
    importlib.util.find_spec(name) for name in ("torch", "tokenizers", "fastapi", "httpx")
)

server = sft = torch = None
_TMP = None


def _build_fixture(out: Path) -> None:
    import torch as _torch
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers

    sys.path.insert(0, str(ROOT / "training" / "phase1"))
    from train import GPT, GPTConfig

    corpus = (
        "Hello there. I am Anima, and I stay with you. What would you like to talk about? "
        "The porch light is on. We can sit a while! Tell me about your day. "
    ) * 50
    tok = Tokenizer(models.BPE(unk_token=None))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tok.train_from_iterator(
        [corpus],
        trainers.BpeTrainer(
            vocab_size=400,
            show_progress=False,
            special_tokens=["<|endoftext|>", "<|user|>", "<|anima|>"],
            initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        ),
    )
    tok.save(str(out / "tokenizer.json"))
    (out / "meta.json").write_text(json.dumps({
        "vocab_size": tok.get_vocab_size(),
        "special": {"endoftext": "<|endoftext|>", "user": "<|user|>", "anima": "<|anima|>"},
    }))
    _torch.manual_seed(0)
    cfg = GPTConfig(vocab_size=tok.get_vocab_size(), block_size=256,
                    n_layer=2, n_head=2, n_embd=64, dropout=0.0)
    _torch.save({"model": GPT(cfg).state_dict(), "cfg": cfg.__dict__}, out / "ckpt.pt")


def setUpModule() -> None:
    global server, sft, torch, _TMP
    if not HAVE_DEPS:
        return
    _TMP = tempfile.TemporaryDirectory()
    out = Path(_TMP.name)
    _build_fixture(out)
    os.environ["ANIMA_CKPT"] = str(out / "ckpt.pt")
    os.environ["ANIMA_TOK_DIR"] = str(out)
    sys.path[:0] = [str(ROOT / "server"), str(ROOT / "training" / "phase2")]
    import server as _server  # loads the checkpoint on import
    import sft as _sft
    import torch as _torch

    server, sft, torch = _server, _sft, _torch


def tearDownModule() -> None:
    if _TMP is not None:
        _TMP.cleanup()


def _sse_events(body: str) -> list[str]:
    return [line[len("data: "):] for line in body.split("\n") if line.startswith("data: ")]


@unittest.skipUnless(HAVE_DEPS, "needs torch, tokenizers, fastapi, httpx")
class ChatCompletionsTests(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient

        self.client = TestClient(server.app)

    def post(self, body: dict):
        return self.client.post("/v1/chat/completions", json=body)

    def test_stream_sends_openai_chunks_and_matches_non_stream(self) -> None:
        body = {
            "model": "anima",
            "max_tokens": 96,
            "temperature": 0.9,
            "messages": [{"role": "user", "content": "Hello there. Tell me about your day."}],
        }
        torch.manual_seed(7)
        whole = self.post(body).json()["choices"][0]
        torch.manual_seed(7)
        res = self.post({**body, "stream": True})

        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.headers["content-type"].startswith("text/event-stream"))
        events = _sse_events(res.text)
        self.assertEqual(events[-1], "[DONE]")
        chunks = [json.loads(e) for e in events[:-1]]
        self.assertTrue(all(c["object"] == "chat.completion.chunk" for c in chunks))
        self.assertEqual(chunks[0]["choices"][0]["delta"], {"role": "assistant", "content": ""})
        self.assertEqual(chunks[-1]["choices"][0]["delta"], {})
        self.assertEqual(chunks[-1]["choices"][0]["finish_reason"], whole["finish_reason"])
        streamed = "".join(c["choices"][0]["delta"].get("content", "") for c in chunks)
        self.assertEqual(streamed, whole["message"]["content"])

    def test_accepts_api_server_request_shapes(self) -> None:
        persona = "You are Serenity, a companion. " * 250
        shapes = {
            "long system prompt": [
                {"role": "system", "content": persona},
                {"role": "user", "content": "Hi, how are you?"},
            ],
            "content parts with an image": [
                {"role": "user", "content": [
                    {"type": "text", "text": "Describe this."},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                ]},
            ],
            "tool-call turn": [
                {"role": "user", "content": "remember this"},
                {"role": "assistant", "content": None, "tool_calls": [
                    {"id": "t1", "type": "function", "function": {"name": "x", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "t1", "content": "saved"},
            ],
            "long history": [
                {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}."}
                for i in range(40)
            ],
            "oversized final message": [
                {"role": "system", "content": "Summarize."},
                {"role": "user", "content": "The porch light is on. " * 520},
            ],
        }
        for name, messages in shapes.items():
            for stream in (False, True):
                with self.subTest(name, stream=stream):
                    res = self.post({
                        "model": "mistralai/Ministral-3-8B-Instruct-2512",
                        "messages": messages,
                        "max_tokens": 4096,
                        "temperature": 0.7,
                        "tools": [],
                        "stream": stream,
                    })
                    self.assertEqual(res.status_code, 200, res.text[:200])

    def test_rejects_messages_with_no_text(self) -> None:
        res = self.post({"messages": [
            {"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:,"}}]},
        ]})
        self.assertEqual(res.status_code, 400)

    def test_bearer_token_enforced_when_set(self) -> None:
        os.environ["ANIMA_SERVER_TOKEN"] = "secret"
        try:
            body = {"messages": [{"role": "user", "content": "hi"}], "max_tokens": 4}
            self.assertEqual(self.post(body).status_code, 401)
            ok = self.client.post(
                "/v1/chat/completions", json=body,
                headers={"Authorization": "Bearer secret"},
            )
            self.assertEqual(ok.status_code, 200)
        finally:
            del os.environ["ANIMA_SERVER_TOKEN"]


@unittest.skipUnless(HAVE_DEPS, "needs torch, tokenizers, fastapi, httpx")
class PromptFitTests(unittest.TestCase):
    def test_prompt_always_leaves_room_for_the_reply(self) -> None:
        block = sft.cfg.block_size
        for max_new in (1, 64, 200, 768):
            for text in ("hi", "The porch light is on. " * 600):
                with self.subTest(max_new=max_new, chars=len(text)):
                    ids = sft.prompt_for_reply([{"role": "user", "content": text}], max_new)
                    self.assertEqual(ids[-1], sft.role_ids["anima"])
                    self.assertLessEqual(len(ids), block - min(max_new, block // 2))

    def test_oversized_message_keeps_its_tail(self) -> None:
        text = "early words. " * 400 + "The question is at the end?"
        ids = sft.prompt_for_reply([{"role": "user", "content": text}], 64)
        decoded = sft.tok.decode(ids)
        self.assertTrue(decoded.rstrip().endswith("The question is at the end?"))


if __name__ == "__main__":
    unittest.main()
