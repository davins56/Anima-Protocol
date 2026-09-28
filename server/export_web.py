# Anima Protocol — package a trained checkpoint for the app.
#
# Run after phase 3 (in Colab or locally):
#   python server/export_web.py
#   python server/export_web.py --ckpt out/anima-sft/ckpt.pt --out out/anima-model.bin
#
# Then upload out/anima-model.bin in Settings -> Model Tutor -> "Upload model".
# In Colab, download it first:
#   from google.colab import files; files.download("out/anima-model.bin")

import argparse
import json
import os
from pathlib import Path

import torch
from tokenizers import Tokenizer

import _paths  # noqa: F401
import weights_io

ROOT = Path(__file__).resolve().parents[1]


def build_bundle(ckpt_path: str, tok_dir: str) -> tuple[bytes, dict]:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    with open(os.path.join(tok_dir, "tokenizer.json"), encoding="utf-8") as f:
        tokenizer_json = f.read()
    with open(os.path.join(tok_dir, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    tok = Tokenizer.from_str(tokenizer_json)
    cfg = weights_io.model_config(ckpt["cfg"])
    if tok.get_vocab_size() != cfg["vocab_size"]:
        raise SystemExit(
            f"tokenizer has {tok.get_vocab_size()} tokens but the checkpoint expects "
            f"{cfg['vocab_size']} — use the tokenizer this checkpoint was trained with"
        )
    inference = weights_io.export_inference(
        ckpt["model"], cfg, weights_io.tokenizer_payload(tokenizer_json), weights_io.special_ids(tok, meta),
    )
    master = weights_io.export_master(ckpt["model"], cfg, tokenizer_json, meta["special"])
    return weights_io.export_bundle(inference, master, cfg), {
        "config": cfg,
        "inference_mb": round(len(inference) / 1e6, 1),
        "master_mb": round(len(master) / 1e6, 1),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ckpt", default=str(ROOT / "out" / "anima-dpo" / "ckpt.pt"),
                        help="checkpoint to export (default: the phase 3 DPO model)")
    parser.add_argument("--tokens", default=str(ROOT / "data" / "anima_tokens"),
                        help="tokenizer directory from phase 1 (tokenizer.json + meta.json)")
    parser.add_argument("--out", default=str(ROOT / "out" / "anima-model.bin"),
                        help="model file to upload in Settings -> Model Tutor")
    args = parser.parse_args()
    bundle, info = build_bundle(args.ckpt, args.tokens)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(bundle)
    print(f"wrote {args.out}: {len(bundle) / 1e6:.1f} MB "
          f"(browser download {info['inference_mb']} MB, trainer copy {info['master_mb']} MB)")
    print("config:", info["config"])
    print("Upload it in Settings -> Model Tutor -> Upload model.")


if __name__ == "__main__":
    main()
