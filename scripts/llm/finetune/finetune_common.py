"""
Shared pieces for unsloth_sft.py / unsloth_dpo.py: dataset loaders, the
baseline hyperparameters, backend detection, and model + LoRA loading.

Two backends produce the same LoRA adapter layout (PEFT `adapter_config.json`
+ `adapter_model.safetensors` + tokenizer), so SFT -> DPO -> export_gguf.py
chain regardless of which one ran:

  unsloth       CUDA box with `pip install "unsloth[colab-new]"` — 4-bit QLoRA,
                fused kernels, the production path (Ministral 3 8B, Qwen2.5 7B).
  transformers  Plain transformers + peft + trl. Used automatically when Unsloth
                is not installed or there is no CUDA device, so the exact same
                command smoke-tests on a CPU sandbox with a tiny base model
                (`--max-steps 20 --base HuggingFaceTB/SmolLM2-135M-Instruct`).

Baseline hyperparameters (QLoRA on a single 12–24 GB GPU):

  learning rate   2e-4 (SFT, LoRA)            5e-6 (DPO)
  batch           2 x grad-accum 8 = 16       1 x 8 = 8
  schedule        cosine, warmup_ratio 0.05   cosine, warmup_ratio 0.1
  precision       bf16 on Ampere+, fp16 on T4/V100, fp32 on CPU
  optimizer       paged_adamw_8bit on CUDA, adamw_torch on CPU
  sequence length 4096 (match num_ctx on the Ollama Modelfile or lower)
  LoRA            r 16, alpha 32, dropout 0.05, all attention + MLP projections
"""

from __future__ import annotations

import json
import os
import platform
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

LORA_TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]

# Used only when the base tokenizer ships no chat template (some *-Base
# checkpoints). Saved with the adapter so serving renders the same layout.
CHATML_TEMPLATE = (
    "{% for message in messages %}"
    "{{ '<|im_start|>' + message['role'] + '\\n' + message['content'] + '<|im_end|>\\n' }}"
    "{% endfor %}"
    "{% if add_generation_prompt %}{{ '<|im_start|>assistant\\n' }}{% endif %}"
)

SHAREGPT_ROLES = {"system": "system", "human": "user", "gpt": "assistant"}


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------


def _iter_jsonl(path: Path) -> Iterable[dict]:
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        yield json.loads(line)


def load_sharegpt(path: Path) -> list[dict]:
    """ShareGPT (`conversations[{from,value}]`) or ChatML (`messages[{role,content}]`)
    JSONL -> `[{"messages": [{role, content}, ...]}]`."""
    rows: list[dict] = []
    for obj in _iter_jsonl(path):
        conv = obj.get("conversations") or obj.get("messages")
        if not conv:
            continue
        messages = []
        # Some ShareGPT exports carry the system prompt as a top-level key.
        system = (obj.get("system") or "").strip()
        if system and not any(t.get("from") == "system" or t.get("role") == "system" for t in conv):
            messages.append({"role": "system", "content": system})
        for turn in conv:
            if "from" in turn:
                role = SHAREGPT_ROLES.get(turn["from"], turn["from"])
                messages.append({"role": role, "content": turn.get("value", "")})
            else:
                messages.append(
                    {"role": turn.get("role", "user"), "content": turn.get("content", "")}
                )
        rows.append({"messages": messages})
    return rows


def _strip_user_prefix(prompt: str) -> str:
    # prepare-dpo writes the last user turn as "user: ..." — the chat template
    # supplies the role, so the literal prefix would be noise inside the turn.
    return prompt[5:].lstrip() if prompt.lower().startswith("user:") else prompt


def load_preference_pairs(path: Path) -> list[dict]:
    """`{prompt, chosen, rejected, system?}` JSONL -> TRL conversational DPO rows,
    so the preference stage renders through the same chat template as SFT
    instead of a raw "system\\n\\nprompt" string."""
    rows: list[dict] = []
    for obj in _iter_jsonl(path):
        prompt = (obj.get("prompt") or "").strip()
        chosen = (obj.get("chosen") or "").strip()
        rejected = (obj.get("rejected") or "").strip()
        system = (obj.get("system") or "").strip()
        if not prompt or not chosen or not rejected:
            continue
        prompt_messages = []
        if system:
            prompt_messages.append({"role": "system", "content": system})
        prompt_messages.append({"role": "user", "content": _strip_user_prefix(prompt)})
        rows.append(
            {
                "prompt": prompt_messages,
                "chosen": [{"role": "assistant", "content": chosen}],
                "rejected": [{"role": "assistant", "content": rejected}],
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Hardware / backend
# ---------------------------------------------------------------------------


@dataclass
class Hardware:
    cuda: bool
    bf16: bool
    device_name: str
    vram_gb: float | None

    @property
    def fp16(self) -> bool:
        return self.cuda and not self.bf16

    @property
    def summary(self) -> str:
        if not self.cuda:
            return f"CPU ({platform.processor() or platform.machine()}) — fp32"
        prec = "bf16" if self.bf16 else "fp16"
        vram = f", {self.vram_gb:.0f} GB" if self.vram_gb else ""
        return f"{self.device_name}{vram} — {prec}"


def detect_hardware() -> Hardware:
    import torch  # type: ignore

    if not torch.cuda.is_available():
        return Hardware(cuda=False, bf16=False, device_name="cpu", vram_gb=None)
    props = torch.cuda.get_device_properties(0)
    return Hardware(
        cuda=True,
        bf16=bool(torch.cuda.is_bf16_supported()),
        device_name=props.name,
        vram_gb=props.total_memory / 1e9,
    )


def require_torch() -> None:
    try:
        import torch  # type: ignore  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "PyTorch is not installed.\n"
            '  CUDA box:  pip install "unsloth[colab-new]" transformers datasets trl\n'
            "  CPU smoke: pip install --index-url https://download.pytorch.org/whl/cpu torch\n"
            "             pip install transformers peft trl datasets accelerate\n"
            f"Original error: {exc}"
        ) from exc


def pick_backend(requested: str, hw: Hardware) -> str:
    """`auto` -> Unsloth when importable on CUDA, else plain transformers+peft.
    Importing Unsloth here (before transformers/trl) is deliberate: it patches
    those libraries on import."""
    if requested == "transformers":
        return "transformers"
    if requested == "unsloth":
        try:
            import unsloth  # type: ignore  # noqa: F401
        except ImportError as exc:
            raise SystemExit(
                "--backend unsloth requested but Unsloth is not installed. "
                'On a CUDA machine: pip install "unsloth[colab-new]" transformers datasets trl\n'
                f"Original error: {exc}"
            ) from exc
        if not hw.cuda:
            raise SystemExit("--backend unsloth needs a CUDA device; use --backend transformers on CPU.")
        return "unsloth"
    if requested != "auto":
        raise SystemExit(f"unknown --backend {requested!r} (auto | unsloth | transformers)")
    if not hw.cuda:
        return "transformers"
    try:
        import unsloth  # type: ignore  # noqa: F401
    except ImportError:
        return "transformers"
    return "unsloth"


def default_optim(hw: Hardware) -> str:
    return "paged_adamw_8bit" if hw.cuda else "adamw_torch"


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


@dataclass
class LoraSpec:
    r: int = 16
    dropout: float = 0.05

    @property
    def alpha(self) -> int:
        return self.r * 2


def adapter_base_id(path: str | Path) -> str | None:
    """If `path` is a saved PEFT adapter, return the base model it was trained on."""
    cfg = Path(path) / "adapter_config.json"
    if not cfg.is_file():
        return None
    try:
        return json.loads(cfg.read_text(encoding="utf-8")).get("base_model_name_or_path")
    except (OSError, ValueError):
        return None


def ensure_chat_template(tokenizer: Any) -> bool:
    """Returns True when a ChatML template had to be installed on the tokenizer."""
    if getattr(tokenizer, "chat_template", None):
        return False
    tokenizer.chat_template = CHATML_TEMPLATE
    return True


def load_model_and_tokenizer(
    base: str,
    *,
    backend: str,
    hw: Hardware,
    max_seq_len: int,
    lora: LoraSpec,
    load_in_4bit: bool,
    gradient_checkpointing: bool,
) -> tuple[Any, Any]:
    """Load `base` (a Hugging Face id, local checkpoint, or a saved LoRA adapter
    dir) and return a trainable PEFT model + tokenizer. Both backends attach
    fresh LoRA weights when `base` is a plain model and resume the existing
    adapter when `base` is an adapter directory (the SFT -> DPO hand-off)."""
    if backend == "unsloth":
        return _load_unsloth(base, hw, max_seq_len, lora, load_in_4bit, gradient_checkpointing)
    return _load_transformers(base, hw, max_seq_len, lora, load_in_4bit, gradient_checkpointing)


def _load_unsloth(base, hw, max_seq_len, lora, load_in_4bit, gradient_checkpointing):
    from unsloth import FastLanguageModel  # type: ignore

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base,
        max_seq_length=max_seq_len,
        load_in_4bit=load_in_4bit,
    )
    # Unsloth skips this with a notice when `base` already carries LoRA
    # adapters (DPO on top of the SFT adapter).
    model = FastLanguageModel.get_peft_model(
        model,
        r=lora.r,
        target_modules=LORA_TARGET_MODULES,
        lora_alpha=lora.alpha,
        lora_dropout=lora.dropout,
        bias="none",
        use_gradient_checkpointing="unsloth" if gradient_checkpointing else False,
    )
    ensure_chat_template(tokenizer)
    return model, tokenizer


def _dtype_kwarg() -> str:
    # transformers 4.56 renamed `torch_dtype` to `dtype` (old name still warns).
    from transformers import __version__ as tv  # type: ignore

    major, minor = (int(x) for x in tv.split(".")[:2])
    return "dtype" if (major, minor) >= (4, 56) else "torch_dtype"


def _load_transformers(base, hw, max_seq_len, lora, load_in_4bit, gradient_checkpointing):
    import torch  # type: ignore
    from peft import LoraConfig, PeftModel, get_peft_model  # type: ignore
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

    base_id = adapter_base_id(base)
    is_adapter = base_id is not None
    model_id = base_id if is_adapter else base

    if hw.cuda:
        dtype = torch.bfloat16 if hw.bf16 else torch.float16
    else:
        dtype = torch.float32

    kwargs: dict[str, Any] = {}
    quantized = False
    if load_in_4bit and hw.cuda:
        try:
            from transformers import BitsAndBytesConfig  # type: ignore
            import bitsandbytes  # type: ignore  # noqa: F401

            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=dtype,
            )
            kwargs["device_map"] = {"": 0}
            quantized = True
        except ImportError:
            print("bitsandbytes not installed — loading full-precision weights (no 4-bit).")
    elif load_in_4bit and not hw.cuda:
        print("No CUDA device — 4-bit quantization skipped, loading fp32 weights.")

    kwargs[_dtype_kwarg()] = dtype
    model = AutoModelForCausalLM.from_pretrained(model_id, **kwargs)

    # The adapter dir carries the tokenizer we trained with (incl. any
    # ChatML template we installed); prefer it over the base's.
    tokenizer = AutoTokenizer.from_pretrained(base if is_adapter else model_id)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.model_max_length = max_seq_len
    ensure_chat_template(tokenizer)

    if quantized:
        from peft import prepare_model_for_kbit_training  # type: ignore

        model = prepare_model_for_kbit_training(
            model, use_gradient_checkpointing=gradient_checkpointing
        )
    elif gradient_checkpointing:
        model.gradient_checkpointing_enable()
        model.enable_input_require_grads()
    model.config.use_cache = False

    if is_adapter:
        model = PeftModel.from_pretrained(model, base, is_trainable=True)
    else:
        model = get_peft_model(
            model,
            LoraConfig(
                r=lora.r,
                lora_alpha=lora.alpha,
                lora_dropout=lora.dropout,
                bias="none",
                target_modules=LORA_TARGET_MODULES,
                task_type="CAUSAL_LM",
            ),
        )
    return model, tokenizer


# ---------------------------------------------------------------------------
# Trainer config helpers + run summary
# ---------------------------------------------------------------------------


def config_kwargs(config_cls: Any, **wanted: Any) -> dict[str, Any]:
    """Drop kwargs the installed trl/transformers version does not know and
    map the renamed ones (`max_seq_length` -> `max_length`,
    `evaluation_strategy` -> `eval_strategy`), so one script spans versions."""
    fields = set(getattr(config_cls, "__dataclass_fields__", {}))
    aliases = {
        "max_length": ("max_length", "max_seq_length"),
        "eval_strategy": ("eval_strategy", "evaluation_strategy"),
        # transformers 5 dropped `warmup_ratio`; `warmup_steps` takes a
        # float in [0, 1) as the ratio instead.
        "warmup_ratio": ("warmup_ratio", "warmup_steps"),
    }
    out: dict[str, Any] = {}
    for key, value in wanted.items():
        if key == "warmup_ratio" and "warmup_ratio" not in fields and "warmup_steps" in fields:
            out["warmup_steps"] = float(value)
            continue
        for candidate in aliases.get(key, (key,)):
            if candidate in fields:
                out[candidate] = value
                break
        else:
            if fields:
                print(f"note: {config_cls.__name__} has no field {key!r} in this trl version — skipped")
    return out


def count_parameters(model: Any) -> tuple[int, int]:
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    return trainable, total


@dataclass
class RunSummary:
    stage: str
    backend: str
    base: str
    out: str
    hardware: str
    hparams: dict[str, Any]
    rows: int
    eval_rows: int
    trainable_params: int
    total_params: int
    steps: int = 0
    train_loss_first: float | None = None
    train_loss_last: float | None = None
    eval_loss: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    seconds: float = 0.0
    finished_at: str = ""

    def fill_from_trainer(self, trainer: Any) -> None:
        history = list(getattr(trainer.state, "log_history", []) or [])
        losses = [h["loss"] for h in history if "loss" in h]
        if losses:
            self.train_loss_first = float(losses[0])
            self.train_loss_last = float(losses[-1])
        evals = [h["eval_loss"] for h in history if "eval_loss" in h]
        if evals:
            self.eval_loss = float(evals[-1])
        self.steps = int(getattr(trainer.state, "global_step", 0) or 0)

    def write(self, out_dir: Path) -> Path:
        self.finished_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "training_summary.json"
        path.write_text(json.dumps(asdict(self), indent=2) + "\n", encoding="utf-8")
        return path

    def print(self) -> None:
        print()
        print(f"{self.stage} done in {self.seconds:.0f}s on {self.hardware} [{self.backend}]")
        print(f"  steps: {self.steps}   rows: {self.rows}   eval rows: {self.eval_rows}")
        if self.train_loss_first is not None:
            print(f"  train loss: {self.train_loss_first:.4f} → {self.train_loss_last:.4f}")
        if self.eval_loss is not None:
            print(f"  eval loss:  {self.eval_loss:.4f}")
        for key, value in self.extra.items():
            print(f"  {key}: {value}")
        print(f"  trainable params: {self.trainable_params:,} / {self.total_params:,}")


def sanity_generate(model: Any, tokenizer: Any, messages: list[dict], max_new_tokens: int = 60) -> str:
    """One greedy reply from the freshly trained adapter — a smoke check that
    the saved chat template + weights produce text, not a quality measure."""
    import torch  # type: ignore

    model.eval()
    if hasattr(model, "config"):
        model.config.use_cache = True
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt")
    device = next(model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            repetition_penalty=1.1,
            pad_token_id=tokenizer.pad_token_id,
        )
    return tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()


def env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"", "0", "false", "no", "off"}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


if __name__ == "__main__":
    print(sys.modules[__name__].__doc__)
