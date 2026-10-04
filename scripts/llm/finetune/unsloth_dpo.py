#!/usr/bin/env python3
"""
DPO preference stage for Anima's companion model.

Runs *after* the SFT stage (unsloth_sft.py) — it sharpens character fidelity,
memory-recall behavior, and boundary handling using chosen/rejected pairs,
without re-teaching base instruction-following. Pairs render through the same
chat template as SFT (system + user prompt → assistant chosen/rejected).

Backend: Unsloth when it is installed on a CUDA box, plain transformers + peft
otherwise — same command, same adapter layout (see finetune_common.py).

Install (CUDA machine, ~12-16 GB VRAM for QLoRA):
  pip install "unsloth[colab-new]" transformers datasets trl

Prepare data first:
  pnpm llm:prepare-dpo
  # -> scripts/llm/output/dpo-pairs.jsonl ({prompt, chosen, rejected, system} per line)

Run (defaults to the SFT adapter as the base — it resumes that adapter):
  python scripts/llm/finetune/unsloth_dpo.py \\
    --data scripts/llm/output/dpo-pairs.jsonl \\
    --base scripts/llm/checkpoints/anima-ministral8b-qlora \\
    --out scripts/llm/checkpoints/anima-ministral8b-dpo

CPU smoke test (after the SFT smoke run):
  python scripts/llm/finetune/unsloth_dpo.py \\
    --data scripts/llm/output/dpo-pairs.jsonl \\
    --base scripts/llm/checkpoints/smoke-sft --out scripts/llm/checkpoints/smoke-dpo \\
    --max-seq-len 1024 --max-steps 10

Then merge / convert to GGUF (export_gguf.py) or serve the adapter with vLLM
LoRA, same as the SFT stage.
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
    adapter_base_id,
    config_kwargs,
    count_parameters,
    default_optim,
    detect_hardware,
    load_model_and_tokenizer,
    load_preference_pairs,
    pick_backend,
    require_torch,
    sanity_generate,
)

DEFAULT_BASE = "scripts/llm/checkpoints/anima-ministral8b-qlora"
DEFAULT_OUT = "scripts/llm/checkpoints/anima-ministral8b-dpo"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DPO for Anima (preference stage after SFT)")
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--base", default=DEFAULT_BASE, help="SFT adapter dir (resumed) or a model id.")
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--backend", choices=["auto", "unsloth", "transformers"], default="auto")
    parser.add_argument("--max-seq-len", type=int, default=4096)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--max-steps", type=int, default=-1, help="Stop after N optimizer steps (smoke tests).")
    parser.add_argument("--lr", type=float, default=5e-6)
    parser.add_argument("--beta", type=float, default=0.1, help="DPO temperature")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--scheduler", default="cosine")
    parser.add_argument("--optim", default="auto", help="auto → paged_adamw_8bit on CUDA, adamw_torch on CPU")
    parser.add_argument("--lora-r", type=int, default=16, help="Only used when --base is not already an adapter.")
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--no-4bit", action="store_true")
    parser.add_argument("--no-gradient-checkpointing", action="store_true")
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--logging-steps", type=int, default=5)
    parser.add_argument("--no-sample", action="store_true", help="Skip the one-line generation sanity check.")
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)

    require_torch()
    hw = detect_hardware()
    backend = pick_backend(args.backend, hw)
    try:
        from datasets import Dataset  # type: ignore
        from trl import DPOConfig, DPOTrainer  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "trl / datasets not installed.\n"
            '  CUDA box:  pip install "unsloth[colab-new]" transformers datasets trl\n'
            "  CPU smoke: pip install transformers peft trl datasets accelerate\n"
            f"Original error: {exc}"
        ) from exc

    rows = load_preference_pairs(args.data)
    if not rows:
        raise SystemExit(f"No preference pairs found in {args.data}")

    optim = default_optim(hw) if args.optim == "auto" else args.optim
    gradient_checkpointing = hw.cuda and not args.no_gradient_checkpointing
    out_dir = Path(args.out)
    resumed_from = adapter_base_id(args.base)

    print(f"Loaded {len(rows)} preference pairs from {args.data}")
    if resumed_from:
        print(f"Base: {args.base} (SFT adapter on {resumed_from} — resuming it)")
    else:
        print(f"Base: {args.base} (fresh LoRA r{args.lora_r})")
    print(f"Hardware: {hw.summary}")
    print(f"Backend:  {backend}")
    print(
        f"Hparams:  lr {args.lr} · beta {args.beta} · batch {args.batch_size}×{args.grad_accum} "
        f"(effective {args.batch_size * args.grad_accum}) · {args.scheduler}, warmup {args.warmup_ratio} · "
        f"{optim} · seq {args.max_seq_len}"
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

    dataset = Dataset.from_list(rows)

    dpo_kwargs = config_kwargs(
        DPOConfig,
        output_dir=str(out_dir),
        max_length=args.max_seq_len,
        max_prompt_length=args.max_seq_len // 2,
        beta=args.beta,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        max_steps=args.max_steps,
        learning_rate=args.lr,
        lr_scheduler_type=args.scheduler,
        warmup_ratio=args.warmup_ratio,
        logging_steps=args.logging_steps,
        save_strategy="epoch" if args.max_steps < 0 else "no",
        # T4 / V100 have no bf16; Ampere+ does. CPU trains in fp32.
        bf16=hw.bf16,
        fp16=hw.fp16,
        optim=optim,
        seed=args.seed,
        report_to=[],
    )

    # ref_model=None: with a PEFT model trl disables the adapter to score the
    # reference policy, so the SFT weights are the reference for free.
    trainer = DPOTrainer(
        model=model,
        ref_model=None,
        processing_class=tokenizer,
        train_dataset=dataset,
        args=DPOConfig(**dpo_kwargs),
    )
    trainable, total = count_parameters(model)
    print(f"Trainable params: {trainable:,} / {total:,}")

    started = time.time()
    trainer.train()
    summary = RunSummary(
        stage="dpo",
        backend=backend,
        base=args.base,
        out=str(out_dir),
        hardware=hw.summary,
        hparams={
            "lr": args.lr,
            "beta": args.beta,
            "batch_size": args.batch_size,
            "grad_accum": args.grad_accum,
            "effective_batch": args.batch_size * args.grad_accum,
            "epochs": args.epochs,
            "max_steps": args.max_steps,
            "scheduler": args.scheduler,
            "warmup_ratio": args.warmup_ratio,
            "optim": optim,
            "max_seq_len": args.max_seq_len,
            "load_in_4bit": not args.no_4bit,
            "seed": args.seed,
            "resumed_adapter_base": resumed_from,
        },
        rows=len(rows),
        eval_rows=0,
        trainable_params=trainable,
        total_params=total,
    )
    summary.fill_from_trainer(trainer)
    history = list(trainer.state.log_history or [])
    accuracies = [h["rewards/accuracies"] for h in history if "rewards/accuracies" in h]
    margins = [h["rewards/margins"] for h in history if "rewards/margins" in h]
    if accuracies:
        summary.extra["reward_accuracy_last"] = round(float(accuracies[-1]), 4)
    if margins:
        summary.extra["reward_margin_last"] = round(float(margins[-1]), 4)
    summary.seconds = time.time() - started

    model.save_pretrained(str(out_dir))
    tokenizer.save_pretrained(str(out_dir))
    print(f"Saved DPO adapter -> {out_dir}")

    if not args.no_sample:
        summary.extra["sample_reply"] = sanity_generate(
            model,
            tokenizer,
            [
                {"role": "system", "content": "You are Serenity from Anima Protocol. Stay in character."},
                {"role": "user", "content": "Wait, are you just ChatGPT with a costume on?"},
            ],
        )

    summary.print()
    path = summary.write(out_dir)
    print(f"Summary -> {path}")


if __name__ == "__main__":
    main()
