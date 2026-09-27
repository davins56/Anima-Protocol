# Phase 1 — Anima tiny-GPT training

From-scratch pretraining pipeline for a ~10M-parameter GPT, sized for free Colab/Kaggle GPUs.

## Usage

1. Place raw .txt corpus files in data/raw/ (TinyStories is a good start).
2. pip install tokenizers numpy torch
3. python training/phase1/data_pipeline.py
4. python training/phase1/train.py

## Notes

- Documents stay separated by <|endoftext|> (TinyStories' own separators are kept; each .txt file is its own document).
- The BPE tokenizer reserves <|endoftext|>, <|user|>, <|anima|> role tokens for Phase 2 SFT.
- Watch val loss: if it plateaus early, add data before growing the model.
- Checkpoints save to out/anima-tiny/ckpt.pt.
