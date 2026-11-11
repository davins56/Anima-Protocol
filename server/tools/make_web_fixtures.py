# Regenerate the fixtures the in-browser engine is tested against
# (artifacts/anima-protocol/src/lib/ownModel/__fixtures__/):
#
#   python server/tools/make_web_fixtures.py
#
# A tiny tokenizer and GPT are trained for a moment, exported in the browser
# format, and PyTorch records what it makes of them — tokenization, prompt
# fitting, logits and a greedy reply. The JavaScript tests must reproduce
# every number, which keeps weights_io.py and the JS reader in step.

import json
import os
import sys
import tempfile
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
import _paths  # noqa: E402,F401

from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers  # noqa: E402

import modeling  # noqa: E402
import sft  # noqa: E402
import weights_io  # noqa: E402
from train import GPT, GPTConfig  # noqa: E402

OUT = ROOT / "artifacts" / "anima-protocol" / "src" / "lib" / "ownModel" / "__fixtures__"
SPECIALS = ["<|endoftext|>", "<|user|>", "<|anima|>"]
CORPUS = [
    "Hello there, I am Anima and I remember you.",
    "How are you feeling today? I missed our talks.",
    "Tell me about your day — I'm listening. Café lights, soft rain.",
    "We'll walk home slowly; it's 10:45 and the stars are out.",
    "I've kept every word you said. Don't worry, you're not alone.",
]
SAMPLES = [
    "Hello there!",
    "I'm here — tell me what happened.",
    "Café ✨ lights at 10:45",
    "  double  spaces\nand a newline\t tab",
    "We'll, you're, I've, don't, it's",
    "",
    "ümlaut 日本語 😀",
]


def build():
    tok_dir = tempfile.mkdtemp()
    tok = Tokenizer(models.BPE(unk_token=None))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tok.train_from_iterator(CORPUS * 10, trainers.BpeTrainer(
        vocab_size=300, special_tokens=SPECIALS,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(), show_progress=False,
    ))
    tok.save(os.path.join(tok_dir, "tokenizer.json"))
    meta = {"vocab_size": tok.get_vocab_size(),
            "special": {"endoftext": SPECIALS[0], "user": SPECIALS[1], "anima": SPECIALS[2]}}
    with open(os.path.join(tok_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    sft.tok = None
    sft.init_tokenizer(tok_dir)

    torch.manual_seed(1234)
    cfg = GPTConfig(vocab_size=tok.get_vocab_size(), block_size=48, n_layer=2, n_head=2, n_embd=32, dropout=0.0)
    model = GPT(cfg)
    # A moment of training so the logits have shape (random init is near-flat).
    data = []
    for line in CORPUS:
        data += modeling.fit_prompt([{"role": "user", "content": "Hi"}], 16)[:-1]
        data += [sft.role_ids["anima"], *sft.encode_text(line), sft.eot_id]
    ids = torch.tensor(data)
    optim = torch.optim.AdamW(model.parameters(), lr=3e-3)
    model.train()
    for _ in range(150):
        start = torch.randint(0, len(ids) - cfg.block_size - 1, (8,))
        x = torch.stack([ids[s:s + cfg.block_size] for s in start])
        y = torch.stack([ids[s + 1:s + cfg.block_size + 1] for s in start])
        _, loss = model(x, y)
        optim.zero_grad()
        loss.backward()
        optim.step()
    model.eval()

    tokenizer_json = Path(tok_dir, "tokenizer.json").read_text(encoding="utf-8")
    blob = weights_io.export_inference(
        model.state_dict(), cfg, weights_io.tokenizer_payload(tokenizer_json), weights_io.special_ids(tok, meta),
    )
    header, state = weights_io.read_inference(blob)
    reference = weights_io.model_from_state(state, header["config"])
    return tok, blob, reference


def main():
    tok, blob, model = build()
    expected = {"tokenize": [], "fit": [], "logits": None, "greedy": None}
    for text in SAMPLES:
        expected["tokenize"].append({"text": text, "ids": sft.encode_text(text)})

    conversation = [
        {"role": "system", "content": "You are Serenity. " * 40},
        {"role": "user", "content": "Hello there!"},
        {"role": "assistant", "content": "Hello, I am Anima and I remember you."},
        {"role": "user", "content": [{"type": "text", "text": "How are you feeling today?"}]},
    ]
    for budget in (48, 24, 16):
        expected["fit"].append({"budget": budget, "ids": modeling.fit_prompt(conversation, budget)})
    expected["fit_messages"] = conversation
    expected["prompt_budget"] = [
        {"block": 48, "max_tokens": m, "budget": modeling.prompt_budget(48, m)} for m in (1, 10, 24, 500)
    ]

    prompt = modeling.fit_prompt([{"role": "user", "content": "How are you feeling today?"}], 24)
    forced = sft.encode_text(" I missed")
    with torch.no_grad():
        logits, _ = model(torch.tensor([prompt + forced]))
    positions = list(range(len(prompt) - 1, len(prompt) + len(forced)))
    expected["logits"] = {
        "ids": prompt + forced,
        "positions": positions,
        "values": [[round(float(v), 6) for v in logits[0, p]] for p in positions],
    }

    tokens = list(modeling.iter_reply_tokens(model, prompt, 20, temperature=1e-5))
    # Greedy steps must not hinge on a near-tie the JS float math could flip.
    idx = torch.tensor([prompt])
    for t in tokens:
        with torch.no_grad():
            step_logits, _ = model(idx)
        top2 = torch.topk(step_logits[0, -1], 2).values
        assert float(top2[0] - top2[1]) > 1e-3, "greedy step too close to call; change the seed"
        idx = torch.cat([idx, torch.tensor([[t]])], dim=1)
    expected["greedy"] = {"prompt": prompt, "tokens": tokens, "text": sft.tok.decode(tokens)}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tiny-model.bin").write_bytes(blob)
    (OUT / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT}/tiny-model.bin ({len(blob)} bytes) and expected.json; greedy={expected['greedy']['text']!r}")


if __name__ == "__main__":
    main()
