#!/usr/bin/env python3
"""
QLoRA SFT for Anima's companion model (Ministral 3 8B by default).

Backend: Unsloth when it is installed on a CUDA box, plain transformers + peft
otherwise — same command, same adapter layout. See finetune_common.py for the
baseline hyperparameters this script defaults to.

Install (CUDA machine, ~12–16 GB VRAM for QLoRA):
  pip install "unsloth[colab-new]" transformers datasets trl

Prepare data first:
  pnpm llm:dataset
  # or: pnpm llm:ingest -- --from ~/Downloads/anima-backup.json && pnpm llm:prepare-finetune -- --val-split 0.05
  # → scripts/llm/output/finetune-sharegpt.jsonl (+ .val.jsonl)

Run (defaults to Ministral 3 8B Base for fine-tuning):
  python scripts/llm/finetune/unsloth_sft.py \\
    --data scripts/llm/output/finetune-sharegpt.jsonl \\
    --eval-data scripts/llm/output/finetune-sharegpt.val.jsonl \\
    --base mistralai/Ministral-3-8B-Base-2512 \\
    --out scripts/llm/checkpoints/anima-ministral8b-qlora

Smoke test the whole pipeline on a CPU sandbox (no Unsloth, no GPU):
  python scripts/llm/finetune/unsloth_sft.py \\
    --data scripts/llm/output/finetune-sharegpt.jsonl \\
    --eval-data scripts/llm/output/finetune-sharegpt.val.jsonl \\
    --base HuggingFaceTB/SmolLM2-135M-Instruct --max-seq-len 1024 --max-steps 20 \\
    --out scripts/llm/checkpoints/smoke-sft

Then run unsloth_dpo.py on the adapter, and export_gguf.py / quantize.sh.
Accept Hugging Face terms for mistralai/* and set HUGGING_FACE_HUB_TOKEN if needed.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from finetune_common import (  # noqa: E402
    LoraSpec,
    RunSummary,
    config_kwargs,
    count_parameters,
    default_optim,
    detect_hardware,
    load_model_and_tokenizer,
    load_sharegpt,
    pick_backend,
    require_torch,
    sanity_generate,
)

DEFAULT_BASE = "mistralai/Ministral-3-8B-Base-2512"
DEFAULT_OUT = "scripts/llm/checkpoints/anima-ministral8b-qlora"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="QLoRA SFT for Anima (Ministral 3 8B)")
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument(
        "--eval-data",
        type=Path,
        default=None,
        help="Optional held-out JSONL (same ShareGPT/messages shape) for eval loss.",
    )
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--backend", choices=["auto", "unsloth", "transformers"], default="auto")
    parser.add_argument("--max-seq-len", type=int, default=4096)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--max-steps", type=int, default=-1, help="Stop after N optimizer steps (smoke tests).")
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=8, help="2 x 8 = effective batch 16.")
    parser.add_argument("--warmup-ratio", type=float, default=0.05)
    parser.add_argument("--scheduler", default="cosine", help="lr_scheduler_type (cosine | linear | constant …)")
    parser.add_argument("--optim", default="auto", help="auto → paged_adamw_8bit on CUDA, adamw_torch on CPU")
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--no-4bit", action="store_true", help="Load full-precision weights (LoRA, not QLoRA).")
    parser.add_argument("--no-gradient-checkpointing", action="store_true")
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--no-sample", action="store_true", help="Skip the one-line generation sanity check.")
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)

    require_torch()
    hw = detect_hardware()
    backend = pick_backend(args.backend, hw)
    try:
        from datasets import Dataset  # type: ignore
        from trl import SFTConfig, SFTTrainer  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "trl / datasets not installed.\n"
            '  CUDA box:  pip install "unsloth[colab-new]" transformers datasets trl\n'
            "  CPU smoke: pip install transformers peft trl datasets accelerate\n"
            f"Original error: {exc}"
        ) from exc

    rows = load_sharegpt(args.data)
    if not rows:
        raise SystemExit(f"No training rows found in {args.data}")
    eval_rows = load_sharegpt(args.eval_data) if args.eval_data else []
    if args.eval_data and not eval_rows:
        raise SystemExit(f"No eval rows found in {args.eval_data}")

    optim = default_optim(hw) if args.optim == "auto" else args.optim
    gradient_checkpointing = hw.cuda and not args.no_gradient_checkpointing
    out_dir = Path(args.out)

    print(f"Loaded {len(rows)} conversations from {args.data}")
    if eval_rows:
        print(f"Loaded {len(eval_rows)} eval conversations from {args.eval_data}")
    print(f"Base model: {args.base}")
    print(f"Hardware:   {hw.summary}")
    print(f"Backend:    {backend}")
    print(
        f"Hparams:    lr {args.lr} · batch {args.batch_size}×{args.grad_accum} "
        f"(effective {args.batch_size * args.grad_accum}) · {args.scheduler}, warmup {args.warmup_ratio} · "
        f"{optim} · seq {args.max_seq_len} · LoRA r{args.lora_r}"
    )

    model, tokenizer = load_model_and_tokenizer(
        args.base,
        backend=backend,
        hw=hw,
        max_seq_len=args.max_seq_len,
        lora=LoraSpec(r=args.lora_r, dropout=args.lora_dropout),
        load_in_4bit=not args.no_4bit,
        gradient_checkpointing=gradient_checkpointing,
    )

    # Render through the chat template ourselves so every trl version sees a
    # plain `text` column (conversational auto-formatting changed across releases).
    def render(example: dict) -> dict:
        return {
            "text": tokenizer.apply_chat_template(
                example["messages"], tokenize=False, add_generation_prompt=False
            )
        }

    dataset = Dataset.from_list(rows).map(render, remove_columns=["messages"])
    eval_dataset = (
        Dataset.from_list(eval_rows).map(render, remove_columns=["messages"]) if eval_rows else None
    )

    sft_kwargs = config_kwargs(
        SFTConfig,
        output_dir=str(out_dir),
        max_length=args.max_seq_len,
        packing=False,
        dataset_text_field="text",
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        max_steps=args.max_steps,
        learning_rate=args.lr,
        lr_scheduler_type=args.scheduler,
        warmup_ratio=args.warmup_ratio,
        weight_decay=args.weight_decay,
        logging_steps=args.logging_steps,
        save_strategy="epoch" if args.max_steps < 0 else "no",
        eval_strategy="epoch" if (eval_dataset is not None and args.max_steps < 0) else "no",
        # T4 / V100 have no bf16; Ampere+ does. Picking the wrong one crashes
        # at the first step. CPU trains in fp32.
        bf16=hw.bf16,
        fp16=hw.fp16,
        optim=optim,
        seed=args.seed,
        report_to=[],
    )

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=dataset,
        eval_dataset=eval_dataset,
        args=SFTConfig(**sft_kwargs),
    )
    trainable, total = count_parameters(model)
    print(f"Trainable params: {trainable:,} / {total:,}")

    started = time.time()
    trainer.train()
    summary = RunSummary(
        stage="sft",
        backend=backend,
        base=args.base,
        out=str(out_dir),
        hardware=hw.summary,
        hparams={
            "lr": args.lr,
            "batch_size": args.batch_size,
            "grad_accum": args.grad_accum,
            "effective_batch": args.batch_size * args.grad_accum,
            "epochs": args.epochs,
            "max_steps": args.max_steps,
            "scheduler": args.scheduler,
            "warmup_ratio": args.warmup_ratio,
            "optim": optim,
            "max_seq_len": args.max_seq_len,
            "lora_r": args.lora_r,
            "lora_alpha": args.lora_r * 2,
            "lora_dropout": args.lora_dropout,
            "load_in_4bit": not args.no_4bit,
            "seed": args.seed,
        },
        rows=len(rows),
        eval_rows=len(eval_rows),
        trainable_params=trainable,
        total_params=total,
    )
    summary.fill_from_trainer(trainer)
    if eval_dataset is not None:
        metrics = trainer.evaluate()
        summary.eval_loss = float(metrics.get("eval_loss", summary.eval_loss or 0.0))
    summary.seconds = time.time() - started

    model.save_pretrained(str(out_dir))
    tokenizer.save_pretrained(str(out_dir))
    print(f"Saved LoRA adapter → {out_dir}")

    if not args.no_sample:
        sample = sanity_generate(
            model,
            tokenizer,
            [
                {"role": "system", "content": "You are Serenity from Anima Protocol. Stay in character."},
                {"role": "user", "content": "Are you just a chatbot?"},
            ],
        )
        summary.extra["sample_reply"] = sample

    summary.print()
    path = summary.write(out_dir)
    print(f"Summary → {path}")


if __name__ == "__main__":
    main()
