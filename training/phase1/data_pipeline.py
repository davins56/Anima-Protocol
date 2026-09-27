# Anima Protocol — Phase 1 data pipeline.
# Turns a folder of raw text files into a tokenized training set
# plus a BPE tokenizer saved for the training script.
# Run before train.py: python data_pipeline.py

import json
import os
import re
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer, models, pre_tokenizers, trainers, decoders

# Paths are anchored at the repo root so the script does not depend on cwd.
ROOT = Path(__file__).resolve().parents[2]

# ----------------------------- Config -----------------------------

RAW_DIR = str(ROOT / "data" / "raw")        # put .txt files here (dialogue, persona text, etc.)
TOK_DIR = str(ROOT / "data" / "anima_tokens")
VOCAB_SIZE = 4096           # small corpus -> small vocab; grow later
MIN_LINE_LEN = 20           # drop junk/blank-ish lines

# --------------------- Step 1: clean the corpus --------------------
# Even a tiny corpus rewards cleaning. This is where Anima's "soul"
# starts: keep the text you'd be proud to have the model imitate.

def clean_text(text: str) -> str:
    text = re.sub(r"\r\n?", "\n", text)
    lines = []
    for line in text.split("\n"):
        line = line.strip()
        if len(line) < MIN_LINE_LEN:
            continue
        line = re.sub(r"[ \t]+", " ", line)
        # drop obvious boilerplate: URLs, page numbers, chapter cruft
        if re.search(r"https?://|^\d+$|chapter \d+", line, re.I):
            continue
        lines.append(line)
    return "\n".join(lines)


def build_corpus():
    if not os.path.isdir(RAW_DIR):
        raise SystemExit(f"missing {RAW_DIR}; create it and add .txt files")
    os.makedirs(TOK_DIR, exist_ok=True)
    chunks = []
    for fname in sorted(os.listdir(RAW_DIR)):
        if not fname.endswith(".txt"):
            continue
        with open(os.path.join(RAW_DIR, fname), encoding="utf-8", errors="ignore") as f:
            cleaned = clean_text(f.read())
        if cleaned:
            chunks.append(cleaned)
            print(f"  {fname}: {len(cleaned):,} chars after cleaning")
    if not chunks:
        raise SystemExit(f"no usable text in {RAW_DIR}")
    corpus = "\n\n".join(chunks)
    with open(ROOT / "data" / "anima_corpus.txt", "w", encoding="utf-8") as f:
        f.write(corpus)
    print(f"corpus total: {len(corpus):,} chars")
    return corpus


# --------------------- Step 2: train the tokenizer ---------------------

def train_tokenizer(corpus: str) -> Tokenizer:
    tok = Tokenizer(models.BPE(unk_token=None))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    trainer = trainers.BpeTrainer(
        vocab_size=VOCAB_SIZE,
        show_progress=True,
        special_tokens=["<|endoftext|>", "<|user|>", "<|anima|>"],
        # ^ reserve slots for later SFT: these become your chat roles.
    )
    tok.train_from_iterator([corpus], trainer)
    tok.save(os.path.join(TOK_DIR, "tokenizer.json"))
    for special in ("<|endoftext|>", "<|user|>", "<|anima|>"):
        tid = tok.token_to_id(special)
        ids = tok.encode(special).ids
        if tid is None or ids != [tid]:
            raise SystemExit(f"special token {special} is not a single id ({ids})")
    return tok


# --------------------- Step 3: tokenize + save ---------------------

def encode_and_save(tok: Tokenizer, corpus: str):
    ids = tok.encode(corpus).ids
    if not ids:
        raise SystemExit("tokenizer produced no tokens")
    if max(ids) > np.iinfo(np.uint16).max:
        raise SystemExit("token ids do not fit in uint16")
    arr = np.array(ids, dtype=np.uint16)
    arr.tofile(os.path.join(TOK_DIR, "train_ids.bin"))
    meta = {
        "vocab_size": tok.get_vocab_size(),
        "special": {"endoftext": "<|endoftext|>", "user": "<|user|>", "anima": "<|anima|>"},
    }
    with open(os.path.join(TOK_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    print(f"tokens: {len(ids):,}  vocab: {tok.get_vocab_size()}")


def run():
    corpus = build_corpus()
    tok = train_tokenizer(corpus)
    encode_and_save(tok, corpus)
    # sanity check: can we round-trip?
    sample = corpus[:200]
    print("round-trip ok:", tok.decode(tok.encode(sample).ids) == sample)


if __name__ == "__main__":
    run()

# Where to get free corpus data (mind each license):
#   - TinyStories (Hugging Face): ~2M simple stories, perfect for tiny models
#   - your own dialogue/persona transcripts — the future Anima gold
#   - Project Gutenberg public-domain books
# Next phase: convert these into <|user|>/<|anima|> chat format for SFT.
