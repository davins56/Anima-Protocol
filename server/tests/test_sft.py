# Phase 2 (training/phase2/sft.py) must fold the steward's taught
# corrections (STEWARD_SFT_DATA) into the dataset the same way Phase 3 DPO
# already does for its preference pairs — see docs/own-model.md
# ("Phases 2 and 3 read both") and training/README.md.
#
# Run from the repo root:
#   pip install -r server/requirements-test.txt
#   python -m unittest discover -s server/tests -v

import json
import tempfile
import unittest
from pathlib import Path

import support as fixtures  # noqa: F401  (sets ANIMA_* first)
import sft  # noqa: E402


def _write_jsonl(path: Path, conversations: list[list[dict]]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for conv in conversations:
            f.write(json.dumps({"messages": conv}) + "\n")


class LoadDatasetTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.sft_path = Path(self._tmp.name, "anima_dialogues.jsonl")
        self.steward_path = Path(self._tmp.name, "steward_lessons.jsonl")
        self._saved = (sft.SFT_DATA, sft.STEWARD_SFT_DATA, sft.CKPT_PATH)
        sft.SFT_DATA = str(self.sft_path)
        sft.STEWARD_SFT_DATA = str(self.steward_path)
        sft.CKPT_PATH = fixtures.BASE
        sft.load_pretrained()
        self.addCleanup(self._restore)

    def _restore(self):
        sft.SFT_DATA, sft.STEWARD_SFT_DATA, sft.CKPT_PATH = self._saved

    def test_includes_steward_lessons_alongside_the_base_dataset(self):
        _write_jsonl(self.sft_path, [
            [{"role": "user", "content": "Hi there"}, {"role": "anima", "content": "Hello, I am here."}],
        ])
        _write_jsonl(self.steward_path, [
            [{"role": "user", "content": "How do you feel?"}, {"role": "anima", "content": "I missed our talks."}],
        ])
        examples = sft.load_dataset()
        # Before this fix, load_dataset() only ever opened SFT_DATA, so the
        # downloaded steward_lessons.jsonl silently had no effect on a
        # from-scratch Phase 2 retrain.
        self.assertEqual(len(examples), 2)

    def test_still_works_with_no_steward_file(self):
        _write_jsonl(self.sft_path, [
            [{"role": "user", "content": "Hi there"}, {"role": "anima", "content": "Hello, I am here."}],
        ])
        self.assertFalse(self.steward_path.exists())
        examples = sft.load_dataset()
        self.assertEqual(len(examples), 1)

    def test_still_requires_the_base_dataset(self):
        self.assertFalse(self.sft_path.exists())
        with self.assertRaises(FileNotFoundError):
            sft.load_dataset()


if __name__ == "__main__":
    unittest.main()
