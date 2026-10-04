# Tests for the shared fine-tune helpers (loaders, hyperparameter plumbing,
# backend selection). No model download, no GPU: runs in CI's
# model-server-tests job and on any laptop with
#   python3 -m unittest discover -s scripts/llm/finetune/tests -v

import json
import os
import sys
import tempfile
import unittest
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import finetune_common as fc  # noqa: E402
import unsloth_dpo  # noqa: E402
import unsloth_sft  # noqa: E402

REPO = HERE.parents[3]
SAMPLES = REPO / "scripts/llm/data/samples"


def write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return path


class ShareGptLoaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="anima-ft-"))

    def test_sharegpt_roles_map_to_chat_roles(self):
        path = write_jsonl(
            self.tmp / "sg.jsonl",
            [
                {
                    "conversations": [
                        {"from": "system", "value": "You are Serenity."},
                        {"from": "human", "value": "hi"},
                        {"from": "gpt", "value": "Hello."},
                    ]
                },
                {},  # no conversations → dropped
                {"messages": [{"role": "user", "content": "x"}, {"role": "assistant", "content": "y"}]},
            ],
        )
        rows = fc.load_sharegpt(path)
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            [m["role"] for m in rows[0]["messages"]], ["system", "user", "assistant"]
        )
        self.assertEqual(rows[0]["messages"][2]["content"], "Hello.")
        self.assertEqual(rows[1]["messages"][0]["role"], "user")

    def test_blank_lines_are_skipped(self):
        path = self.tmp / "blank.jsonl"
        path.write_text('\n{"messages":[{"role":"user","content":"a"}]}\n\n', encoding="utf-8")
        self.assertEqual(len(fc.load_sharegpt(path)), 1)


class PreferenceLoaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="anima-ft-"))

    def test_pairs_become_conversational_rows_with_system(self):
        path = write_jsonl(
            self.tmp / "dpo.jsonl",
            [
                {
                    "system": "You are Serenity from Anima Protocol.",
                    "prompt": "user: Are you just ChatGPT?",
                    "chosen": "No — I am Serenity.",
                    "rejected": "As an AI language model...",
                },
                {"prompt": "no system", "chosen": "c", "rejected": "r"},
                {"prompt": "missing rejected", "chosen": "c", "rejected": ""},
            ],
        )
        rows = fc.load_preference_pairs(path)
        self.assertEqual(len(rows), 2)
        first = rows[0]
        self.assertEqual([m["role"] for m in first["prompt"]], ["system", "user"])
        # The "user:" prefix is a transcript artefact; the template supplies the role.
        self.assertEqual(first["prompt"][1]["content"], "Are you just ChatGPT?")
        self.assertEqual(first["chosen"], [{"role": "assistant", "content": "No — I am Serenity."}])
        self.assertEqual(first["rejected"][0]["role"], "assistant")
        self.assertEqual([m["role"] for m in rows[1]["prompt"]], ["user"])

    def test_strip_user_prefix_is_case_insensitive_and_safe(self):
        self.assertEqual(fc._strip_user_prefix("User:  hey"), "hey")
        self.assertEqual(fc._strip_user_prefix("hey user: there"), "hey user: there")


class ConfigKwargsTests(unittest.TestCase):
    def test_maps_renamed_fields_and_drops_unknown(self):
        @dataclass
        class NewStyle:
            max_length: int = 0
            eval_strategy: str = "no"
            warmup_steps: float = 0
            lr: float = 0.0

        out = fc.config_kwargs(
            NewStyle, max_length=4096, eval_strategy="epoch", warmup_ratio=0.05, lr=1e-4, bogus=1
        )
        self.assertEqual(
            out, {"max_length": 4096, "eval_strategy": "epoch", "warmup_steps": 0.05, "lr": 1e-4}
        )

    def test_keeps_old_names_when_that_is_what_the_library_has(self):
        @dataclass
        class OldStyle:
            max_seq_length: int = 0
            evaluation_strategy: str = "no"
            warmup_ratio: float = 0.0

        out = fc.config_kwargs(OldStyle, max_length=2048, eval_strategy="steps", warmup_ratio=0.1)
        self.assertEqual(
            out, {"max_seq_length": 2048, "evaluation_strategy": "steps", "warmup_ratio": 0.1}
        )


class AdapterDetectionTests(unittest.TestCase):
    def test_adapter_dir_reports_its_base(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(fc.adapter_base_id(d))
            Path(d, "adapter_config.json").write_text(
                json.dumps({"base_model_name_or_path": "unsloth/Qwen2.5-7B-Instruct-bnb-4bit"})
            )
            self.assertEqual(fc.adapter_base_id(d), "unsloth/Qwen2.5-7B-Instruct-bnb-4bit")
        self.assertIsNone(fc.adapter_base_id("mistralai/Ministral-3-8B-Base-2512"))


class BackendAndHparamTests(unittest.TestCase):
    cpu = fc.Hardware(cuda=False, bf16=False, device_name="cpu", vram_gb=None)
    t4 = fc.Hardware(cuda=True, bf16=False, device_name="Tesla T4", vram_gb=15.8)
    a100 = fc.Hardware(cuda=True, bf16=True, device_name="A100", vram_gb=40.0)

    def test_precision_follows_hardware(self):
        self.assertFalse(self.cpu.fp16)
        self.assertTrue(self.t4.fp16)
        self.assertFalse(self.a100.fp16)
        self.assertIn("fp32", self.cpu.summary)
        self.assertIn("fp16", self.t4.summary)
        self.assertIn("bf16", self.a100.summary)

    def test_optimizer_defaults(self):
        self.assertEqual(fc.default_optim(self.cpu), "adamw_torch")
        self.assertEqual(fc.default_optim(self.a100), "paged_adamw_8bit")

    def test_cpu_never_picks_unsloth(self):
        self.assertEqual(fc.pick_backend("auto", self.cpu), "transformers")
        self.assertEqual(fc.pick_backend("transformers", self.a100), "transformers")
        with self.assertRaises(SystemExit):
            fc.pick_backend("unsloth", self.cpu)
        with self.assertRaises(SystemExit):
            fc.pick_backend("nope", self.cpu)

    def test_sft_defaults_match_the_documented_baseline(self):
        args = unsloth_sft.build_parser().parse_args(["--data", "x.jsonl"])
        self.assertEqual(args.lr, 2e-4)
        self.assertEqual(args.batch_size * args.grad_accum, 16)
        self.assertEqual(args.warmup_ratio, 0.05)
        self.assertEqual(args.scheduler, "cosine")
        self.assertEqual(args.max_seq_len, 4096)
        self.assertEqual(args.lora_r, 16)
        self.assertEqual(args.max_steps, -1)
        self.assertEqual(args.backend, "auto")
        self.assertEqual(args.base, "mistralai/Ministral-3-8B-Base-2512")

    def test_dpo_defaults(self):
        args = unsloth_dpo.build_parser().parse_args(["--data", "x.jsonl"])
        self.assertEqual(args.lr, 5e-6)
        self.assertEqual(args.beta, 0.1)
        self.assertEqual(args.warmup_ratio, 0.1)
        self.assertEqual(args.base, "scripts/llm/checkpoints/anima-ministral8b-qlora")

    def test_colab_notebook_flags_still_parse(self):
        # colab_scribe_qlora.ipynb drives these scripts; keep its invocations valid.
        unsloth_sft.build_parser().parse_args(
            "--data a --eval-data b --base unsloth/Qwen2.5-7B-Instruct-bnb-4bit --out o "
            "--max-seq-len 2048 --epochs 1 --batch-size 2 --grad-accum 4".split()
        )
        unsloth_dpo.build_parser().parse_args(
            "--data a --base b --out o --max-seq-len 2048 --epochs 1".split()
        )


class ChatTemplateTests(unittest.TestCase):
    def test_installs_chatml_only_when_missing(self):
        class Tok:
            chat_template = None

        tok = Tok()
        self.assertTrue(fc.ensure_chat_template(tok))
        self.assertIn("<|im_start|>", tok.chat_template)
        self.assertFalse(fc.ensure_chat_template(tok))


class RunSummaryTests(unittest.TestCase):
    def test_summary_reads_trainer_history_and_writes_json(self):
        class State:
            log_history = [
                {"loss": 3.7, "step": 2},
                {"loss": 3.5, "step": 4},
                {"eval_loss": 3.6, "step": 4},
                {"train_runtime": 1.0},
            ]
            global_step = 4

        class Trainer:
            state = State()

        s = fc.RunSummary(
            stage="sft", backend="transformers", base="b", out="o", hardware="cpu",
            hparams={"lr": 2e-4}, rows=10, eval_rows=2, trainable_params=5, total_params=100,
        )
        s.fill_from_trainer(Trainer())
        self.assertEqual((s.train_loss_first, s.train_loss_last, s.eval_loss, s.steps), (3.7, 3.5, 3.6, 4))
        with tempfile.TemporaryDirectory() as d:
            path = s.write(Path(d))
            data = json.loads(path.read_text())
            self.assertEqual(data["stage"], "sft")
            self.assertEqual(data["hparams"]["lr"], 2e-4)
            self.assertTrue(data["finished_at"])


@unittest.skipUnless(SAMPLES.is_dir(), "committed sample fixtures missing")
class CommittedSamplesTests(unittest.TestCase):
    def test_sharegpt_sample_loads(self):
        path = SAMPLES / "sharegpt-serenity.json"
        raw = json.loads(path.read_text(encoding="utf-8"))
        rows = raw if isinstance(raw, list) else [raw]
        tmp = Path(tempfile.mkdtemp()) / "s.jsonl"
        write_jsonl(tmp, rows)
        loaded = fc.load_sharegpt(tmp)
        self.assertGreaterEqual(len(loaded), 1)
        self.assertTrue(any(m["role"] == "assistant" for m in loaded[0]["messages"]))
        # Top-level "system" is folded in as the first turn.
        self.assertEqual(loaded[0]["messages"][0]["role"], "system")
        self.assertIn("Serenity", loaded[0]["messages"][0]["content"])


if __name__ == "__main__":
    unittest.main()
