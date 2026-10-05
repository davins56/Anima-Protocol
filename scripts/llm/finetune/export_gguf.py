#!/usr/bin/env python3
"""
Merge a LoRA adapter (SFT or DPO stage) into its base and export GGUF for
Ollama — the step between unsloth_dpo.py and `ollama create`.

  python scripts/llm/finetune/export_gguf.py \\
    --adapter scripts/llm/checkpoints/anima-scribe-dpo \\
    --out scripts/llm/gguf --prefix anima-scribe --quant q4_k_m

Writes <out>/<prefix>-<quant>.gguf (Unsloth builds llama.cpp on first use)
and, with --merged-dir, the merged fp16 HF checkpoint for vLLM or
quantize.sh. Fits a free Colab T4: merging happens on CPU RAM, so keep the
runtime's RAM at the default 12 GB or more.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge LoRA adapter and export GGUF")
    parser.add_argument("--adapter", required=True, type=Path, help="adapter dir saved by unsloth_sft/dpo")
    parser.add_argument("--out", type=Path, default=Path("scripts/llm/gguf"))
    parser.add_argument("--prefix", default="anima-scribe")
    parser.add_argument(
        "--quant",
        default="q4_k_m",
        help="llama.cpp quant: q4_k_m (default, ~4.7 GB for 7B), q5_k_m, q8_0, f16",
    )
    parser.add_argument("--merged-dir", type=Path, default=None, help="also save merged fp16 HF weights here")
    parser.add_argument("--max-seq-len", type=int, default=4096)
    args = parser.parse_args()

    try:
        from unsloth import FastLanguageModel  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            'Unsloth not installed. On the GPU host: pip install "unsloth[colab-new]"\n'
            f"Original error: {exc}"
        ) from exc

    if not args.adapter.is_dir():
        raise SystemExit(f"adapter dir not found: {args.adapter}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=str(args.adapter),
        max_seq_length=args.max_seq_len,
        load_in_4bit=True,
    )

    if args.merged_dir:
        model.save_pretrained_merged(str(args.merged_dir), tokenizer, save_method="merged_16bit")
        print(f"Saved merged fp16 checkpoint -> {args.merged_dir}")

    args.out.mkdir(parents=True, exist_ok=True)
    work = args.out / f"{args.prefix}-gguf-work"
    model.save_pretrained_gguf(str(work), tokenizer, quantization_method=args.quant)

    produced = sorted(work.glob("*.gguf"), key=lambda p: p.stat().st_size)
    if not produced:
        raise SystemExit(f"no .gguf written under {work}")
    final = args.out / f"{args.prefix}-{args.quant}.gguf"
    shutil.move(str(produced[0]), final)
    shutil.rmtree(work, ignore_errors=True)
    print(f"Wrote {final} ({final.stat().st_size / 1e9:.2f} GB)")
    print()
    print("Next:")
    print(f"  ollama create {args.prefix} -f scripts/llm/Modelfile.{args.prefix}-tuned")
    print(f"  export ANIMA_OLLAMA_MODEL_STANDARD={args.prefix}")
    print("  pnpm llm:eval")


if __name__ == "__main__":
    main()
