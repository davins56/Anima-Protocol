# Sample novel transcripts (synthetic)

These are **original** Speaker: scenes that exercise the curator. They are
not excerpts from the operator novels. Drop real extracts in `llm-raw-source/`
(gitignored); the first matching book id wins over these fixtures.

| File | Book | Register | SFT mix |
|------|------|----------|---------|
| `anima-protocol.txt` | anima-protocol | gold | 4× |
| `seraph-code.txt` | seraph-code | clinical-gentle | 2× |
| `fallen-circuit.txt` | fallen-circuit | withholding | 2× |
| `slipthk-war.txt` | slipthk-war | slipthk, trust-gated | 1× |
| `fallen-angel.txt` | fallen-angel | world-lore | 0× (excluded) |

`pnpm llm:curate-novels` (and `pnpm llm:dataset`) pick these up when the
shared-box novels are not on disk.
