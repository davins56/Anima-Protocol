#!/usr/bin/env python3
"""
Unsloth DPO preference stage for Anima's companion model.

Runs *after* the SFT stage (unsloth_sft.py) — it sharpens character fidelity,
memory-recall behavior, and boundary handling using chosen/rejected pairs,
without re-teaching base instruction-following.

Install (CUDA machine, ~12-16 GB VRAM for QLoRA):
  pip install "unsloth[colab-new]" transformers datasets trl

Prepare data first:
  pnpm llm:prepare-dpo
  # -> scripts/llm/output/dpo-pairs.jsonl ({prompt, chosen, rejected, system} per line)

Run (defaults to the merged SFT adapter as the base):
  python scripts/llm/finetune/unsloth_dpo.py \\
    --data scripts/llm/output/dpo-pairs.jsonl \\
    --base scripts/llm/checkpoints/anima-ministral8b-qlora \\
    --out scripts/llm/checkpoints/anima-ministral8b-dpo

Then merge / convert to GGUF or serve the adapter with vLLM LoRA, same as
the SFT stage. Accept Hugging Face terms for mistralai/* and set
HUGGING_FACE_HUB_TOKEN if starting from the base model instead of an SFT
checkpoint.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

DEFAULT_BASE = "scripts/llm/checkpoints/anima-ministral8b-qlora"
DEFAULT_OUT = "scripts/llm/checkpoints/anima-ministral8b-dpo"


def load_preference_pairs(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        prompt = obj.get("prompt", "")
        chosen = obj.get("chosen", "")
        rejected = obj.get("rejected", "")
        system = obj.get("system", "")
        if not chosen or not rejected:
            continue
        full_prompt = f"{system}\n\n{prompt}".strip() if system else prompt
        rows.append({"prompt": full_prompt, "chosen": chosen, "rejected": rejected})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unsloth DPO for Anima (preference stage after SFT)"
    )
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--max-seq-len", type=int, default=4096)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--lr", type=float, default=5e-6)
    parser.add_argument("--beta", type=float, default=0.1, help="DPO temperature")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--lora-r", type=int, default=16)
    args = parser.parse_args()

    try:
        from unsloth import FastLanguageModel  # type: ignore
        from datasets import Dataset  # type: ignore
        from trl import DPOConfig, DPOTrainer  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "Unsloth stack not installed. On a CUDA machine:\n"
            '  pip install "unsloth[colab-new]" transformers datasets trl\n'
            f"Original error: {exc}"
        ) from exc

    rows = load_preference_pairs(args.data)
    if not rows:
        raise SystemExit(f"No preference pairs found in {args.data}")

    print(f"Loaded {len(rows)} preference pairs from {args.data}")
    print(f"Base: {args.base}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base,
        max_seq_length=args.max_seq_len,
        load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_alpha=args.lora_r * 2,
        lora_dropout=0.05,
        bias="none",
        use_gradient_checkpointing="unsloth",
    )

    dataset = Dataset.from_list(rows)

    trainer = DPOTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=dataset,
        args=DPOConfig(
            output_dir=args.out,
            max_length=args.max_seq_len,
            max_prompt_length=args.max_seq_len // 2,
            beta=args.beta,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            logging_steps=5,
            save_strategy="epoch",
            bf16=True,
            optim="adamw_8bit",
            report_to=[],
        ),
    )
    trainer.train()
    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    print(f"Saved DPO adapter -> {args.out}")


if __name__ == "__main__":
    main()
