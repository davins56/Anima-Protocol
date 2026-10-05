# Shared fixtures for the server tests: a tiny tokenizer and a randomly
# initialised 1-layer GPT in a temp dir, so no trained checkpoint is needed.
# Import this before `server` — it points ANIMA_* at the fixtures first.

import atexit
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
import _paths  # noqa: E402,F401

from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers  # noqa: E402
from train import GPT, GPTConfig  # noqa: E402

SPECIALS = ["<|endoftext|>", "<|user|>", "<|anima|>"]
CORPUS = " ".join([
    "Hello there, I am Anima and I remember you.",
    "How are you feeling today? I missed our talks.",
    "The stars were quiet over the city, and we walked home slowly.",
    "Tell me about your day, I am listening. Café lights, soft rain.",
] * 20)

TMP = tempfile.mkdtemp(prefix="anima-server-test-")
atexit.register(shutil.rmtree, TMP, ignore_errors=True)


def build_tokenizer(tok_dir: str) -> Tokenizer:
    os.makedirs(tok_dir, exist_ok=True)
    tok = Tokenizer(models.BPE(unk_token=None))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    trainer = trainers.BpeTrainer(
        vocab_size=400,
        special_tokens=SPECIALS,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        show_progress=False,
    )
    tok.train_from_iterator([CORPUS], trainer)
    tok.save(os.path.join(tok_dir, "tokenizer.json"))
    with open(os.path.join(tok_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "vocab_size": tok.get_vocab_size(),
            "special": {"endoftext": SPECIALS[0], "user": SPECIALS[1], "anima": SPECIALS[2]},
        }, f)
    return tok


def build_checkpoint(path: str, vocab_size: int, seed: int = 0) -> None:
    torch.manual_seed(seed)
    cfg = GPTConfig(vocab_size=vocab_size, block_size=64, n_layer=1, n_head=2, n_embd=32, dropout=0.0)
    torch.save({"model": GPT(cfg).state_dict(), "cfg": cfg.__dict__}, path)


TOK_DIR = os.path.join(TMP, "tokens")
BASE = os.path.join(TMP, "base.pt")
_tok = build_tokenizer(TOK_DIR)
build_checkpoint(BASE, _tok.get_vocab_size())

os.environ["ANIMA_TOK_DIR"] = TOK_DIR
os.environ["ANIMA_CKPT"] = BASE
os.environ["ANIMA_LIVE_DIR"] = os.path.join(TMP, "live-server")
os.environ.pop("ANIMA_SERVER_TOKEN", None)
os.environ.pop("ANIMA_LEARNING", None)

import sft  # noqa: E402

sft.init_tokenizer(TOK_DIR)

import learning  # noqa: E402


class FastLearning:
    """Train hard enough that a 1-layer random model memorises one reply."""

    def setUp(self):
        self._saved = (learning.LESSON_LR, learning.LESSON_MAX_STEPS, learning.LESSON_TARGET_LOSS)
        learning.LESSON_LR = 3e-3
        learning.LESSON_MAX_STEPS = 300
        learning.LESSON_TARGET_LOSS = 0.05

    def tearDown(self):
        learning.LESSON_LR, learning.LESSON_MAX_STEPS, learning.LESSON_TARGET_LOSS = self._saved
