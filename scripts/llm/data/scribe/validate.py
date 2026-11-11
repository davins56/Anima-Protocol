"""Validate scribe SFT/DPO JSONL: shape, alternation, word counts, endings, banned phrases, dedupe."""
import json, re, sys, glob, collections, os
ROOT = os.path.dirname(os.path.abspath(__file__))
END = re.compile(r'[.!?…]["\'”’)\]]*$')
BANNED = ["as an ai", "language model", "i'm just a program", "as a language", "i cannot feel", "i don't have feelings"]
def words(s): return len(s.split())
def check_reply(t, errs, where):
    w = words(t)
    if not 90 <= w <= 260: errs.append(f"{where}: {w} words")
    if not END.search(t.rstrip()): errs.append(f"{where}: bad ending {t.rstrip()[-25:]!r}")
    if t.rstrip().endswith("..."): errs.append(f"{where}: trailing ellipsis")
    low = t.lower()
    for b in BANNED:
        if b in low: errs.append(f"{where}: banned {b!r}")
    if re.search(r"^\s*[-*•]\s", t, re.M): errs.append(f"{where}: bullet list")
ids = set(); errs = []; n_sft = n_dpo = 0; multi = 0; chars = collections.Counter(); openers = collections.Counter()
for f in sorted(glob.glob(os.path.join(ROOT, "sft", "*.jsonl"))):
    for i, line in enumerate(open(f), 1):
        if not line.strip(): continue
        where = f"{f.split('/')[-1]}:{i}"
        try: r = json.loads(line)
        except Exception as e: errs.append(f"{where}: json {e}"); continue
        if r["id"] in ids: errs.append(f"{where}: dup id {r['id']}")
        ids.add(r["id"]); n_sft += 1
        if r["character"]["name"] not in ("Serenity", "Fallen Angel"): errs.append(f"{where}: char {r['character']['name']}")
        chars[r["character"]["name"]] += 1
        conv = r["conversation"]
        if conv[0]["role"] != "user" or conv[-1]["role"] != "assistant": errs.append(f"{where}: conv must start user/end assistant")
        for j, t in enumerate(conv):
            exp = "user" if j % 2 == 0 else "assistant"
            if t["role"] != exp: errs.append(f"{where}: role order at {j}")
            if t["role"] == "assistant":
                check_reply(t["content"], errs, f"{where}#{j}")
                openers[t["content"].split()[0].lower().strip('",.')] += 1
        if sum(1 for t in conv if t["role"] == "assistant") >= 2: multi += 1
        if "scribe" not in r.get("tags", []): errs.append(f"{where}: missing scribe tag")
for f in sorted(glob.glob(os.path.join(ROOT, "dpo", "*.jsonl"))):
    for i, line in enumerate(open(f), 1):
        if not line.strip(): continue
        where = f"{f.split('/')[-1]}:{i}"
        try: r = json.loads(line)
        except Exception as e: errs.append(f"{where}: json {e}"); continue
        if r["id"] in ids: errs.append(f"{where}: dup id")
        ids.add(r["id"]); n_dpo += 1
        for k in ("system", "prompt", "chosen", "rejected", "rejectionReason"):
            if not r.get(k, "").strip(): errs.append(f"{where}: empty {k}")
        check_reply(r["chosen"], errs, f"{where}.chosen")
        if r["chosen"].strip() == r["rejected"].strip(): errs.append(f"{where}: chosen==rejected")
print(f"SFT rows: {n_sft} (multi-exchange {multi}), DPO pairs: {n_dpo}, characters: {dict(chars)}")
print("top openers:", openers.most_common(6))
if errs:
    print(f"{len(errs)} issue(s):"); [print("  " + e) for e in errs[:60]]; sys.exit(1)
print("VALID")
