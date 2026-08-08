#!/usr/bin/env python3
"""
Unsloth QLoRA SFT for Anima's Ministral 3 8B companion model.

Install (CUDA machine, ~12–16 GB VRAM for QLoRA):
  pip install "unsloth[colab-new]" transformers datasets trl

Prepare data first:
  pnpm llm:prepare-finetune
  # → scripts/llm/output/finetune-sharegpt.jsonl

Run (defaults to Ministral 3 8B Base for fine-tuning):
  python scripts/llm/finetune/unsloth_sft.py \\
    --data scripts/llm/output/finetune-sharegpt.jsonl \\
    --base mistralai/Ministral-3-8B-Base-2512 \\
    --out scripts/llm/checkpoints/anima-ministral8b-qlora

Then merge / convert to GGUF or serve the adapter with vLLM LoRA.
Accept Hugging Face terms for mistralai/* and set HUGGING_FACE_HUB_TOKEN if needed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

DEFAULT_BASE = "mistralai/Ministral-3-8B-Base-2512"
DEFAULT_OUT = "scripts/llm/checkpoints/anima-ministral8b-qlora"


def load_sharegpt(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        conv = obj.get("conversations") or obj.get("messages")
        if not conv:
            continue
        # Normalize to messages[{role, content}]
        messages = []
        for turn in conv:
            if "from" in turn:
                role = {"system": "system", "human": "user", "gpt": "assistant"}.get(
                    turn["from"], turn["from"]
                )
                messages.append({"role": role, "content": turn.get("value", "")})
            else:
                messages.append(
                    {"role": turn.get("role", "user"), "content": turn.get("content", "")}
                )
        rows.append({"messages": messages})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unsloth QLoRA SFT for Anima (Ministral 3 8B)"
    )
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--max-seq-len", type=int, default=4096)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--lora-r", type=int, default=16)
    args = parser.parse_args()

    try:
        from unsloth import FastLanguageModel  # type: ignore
        from datasets import Dataset  # type: ignore
        from trl import SFTConfig, SFTTrainer  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "Unsloth stack not installed. On a CUDA machine:\n"
            '  pip install "unsloth[colab-new]" transformers datasets trl\n'
            f"Original error: {exc}"
        ) from exc

    rows = load_sharegpt(args.data)
    if not rows:
        raise SystemExit(f"No training rows found in {args.data}")

    print(f"Loaded {len(rows)} conversations from {args.data}")
    print(f"Base model: {args.base}")

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

    # trl calls this per-row (batched=False), so `example` is one
    # {"messages": [...]} conversation, not a batch — must return one string.
    def formatting_func(example: dict) -> str:
        return tokenizer.apply_chat_template(
            example["messages"], tokenize=False, add_generation_prompt=False
        )

    dataset = Dataset.from_list(rows)

    # trl >= 0.12 moved tokenizer/max_seq_length/packing off SFTTrainer's own
    # kwargs and onto SFTConfig (processing_class= replaces tokenizer=).
    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=dataset,
        formatting_func=formatting_func,
        args=SFTConfig(
            output_dir=args.out,
            max_length=args.max_seq_len,
            packing=False,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            logging_steps=10,
            save_strategy="epoch",
            bf16=True,
            optim="adamw_8bit",
            report_to=[],
        ),
    )
    trainer.train()
    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    print(f"Saved LoRA adapter → {args.out}")


if __name__ == "__main__":
    main()
