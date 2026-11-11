# Anima Protocol — model files the app stores and runs.
#
# Every published version of the steward's own model is two artifacts:
#
#   inference ("anima-web-1")  what browsers download and run. int8 weight
#                              matrices with one float32 scale per row, float32
#                              biases and norms, the tokenizer, and a JSON header
#                              describing it all. ~14 MB for the default config.
#   master                     fp16 state_dict (torch.save, weights_only-safe)
#                              the trainer resumes from. Never sent to browsers.
#
# A bundle ("anima-model-1") packs both into one file, so a model trained in
# Colab is a single upload in Settings -> Model Tutor.
#
# The JavaScript reader lives in artifacts/anima-protocol/src/lib/ownModel/;
# keep the two in step (server/tools/make_web_fixtures.py checks them).

import hashlib
import io
import json
import struct

import torch

import _paths  # noqa: F401
import sft
from train import GPT, GPTConfig

WEB_MAGIC = b"ANIMAWEB"
WEB_FORMAT = "anima-web-1"
BUNDLE_MAGIC = b"ANIMAMDL"
BUNDLE_FORMAT = "anima-model-1"
CONFIG_KEYS = ("vocab_size", "block_size", "n_layer", "n_head", "n_embd")


def _align4(n: int) -> int:
    return (n + 3) // 4 * 4


def model_config(cfg) -> dict:
    source = cfg if isinstance(cfg, dict) else cfg.__dict__
    return {k: int(source[k]) for k in CONFIG_KEYS}


def serving_state(state_dict: dict) -> dict:
    """Parameters only: the causal mask buffers are rebuilt from the config."""
    return {k: v for k, v in state_dict.items() if not k.endswith(".attn.mask")}


def tokenizer_payload(tokenizer_json: str) -> dict:
    """Vocab and merges from a Hugging Face tokenizers ByteLevel-BPE file."""
    data = json.loads(tokenizer_json)
    model = data.get("model") or {}
    if model.get("type") != "BPE":
        raise ValueError("tokenizer must be a BPE model")
    merges = []
    for merge in model.get("merges") or []:
        pair = merge.split(" ", 1) if isinstance(merge, str) else list(merge)
        if len(pair) != 2:
            raise ValueError(f"bad merge entry {merge!r}")
        merges.append(pair)
    return {"vocab": model["vocab"], "merges": merges}


# --------------------------- inference blob ---------------------------

def export_inference(state_dict: dict, cfg, tokenizer: dict, special: dict) -> bytes:
    """Quantize a float state_dict into the browser format."""
    tensors = []
    data = bytearray()
    for name, value in serving_state(state_dict).items():
        t = value.detach().to(torch.float32).cpu()
        if t.dim() == 2:
            scale = t.abs().amax(dim=1) / 127.0
            scale = torch.where(scale > 0, scale, torch.ones_like(scale))
            q = torch.round(t / scale[:, None]).clamp_(-127, 127).to(torch.int8)
            offset = len(data)
            data += q.numpy().tobytes()
            data += b"\0" * (_align4(len(data)) - len(data))
            scales_offset = len(data)
            data += scale.numpy().astype("<f4").tobytes()
            tensors.append({
                "name": name,
                "dtype": "q8",
                "shape": list(t.shape),
                "offset": offset,
                "scales_offset": scales_offset,
            })
        else:
            offset = len(data)
            data += t.reshape(-1).numpy().astype("<f4").tobytes()
            tensors.append({"name": name, "dtype": "f32", "shape": list(t.shape), "offset": offset})
    header = {
        "format": WEB_FORMAT,
        "config": model_config(cfg),
        "special": {k: int(v) for k, v in special.items()},
        "tokenizer": tokenizer,
        "tensors": tensors,
        "data_bytes": len(data),
    }
    header_bytes = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    prefix = WEB_MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes
    prefix += b"\0" * (_align4(len(prefix)) - len(prefix))
    return bytes(prefix) + bytes(data)


def read_inference(blob: bytes) -> tuple[dict, dict]:
    """(header, float32 state_dict) — the weights exactly as browsers see them."""
    if blob[:8] != WEB_MAGIC:
        raise ValueError("not an anima-web inference blob")
    (header_len,) = struct.unpack_from("<I", blob, 8)
    header = json.loads(blob[12:12 + header_len].decode("utf-8"))
    if header.get("format") != WEB_FORMAT:
        raise ValueError(f"unsupported inference format {header.get('format')!r}")
    base = _align4(12 + header_len)
    state = {}
    for t in header["tensors"]:
        shape = t["shape"]
        count = 1
        for d in shape:
            count *= d
        if t["dtype"] == "q8":
            rows = shape[0]
            q = torch.frombuffer(bytearray(blob[base + t["offset"]:base + t["offset"] + count]), dtype=torch.int8)
            scale = torch.frombuffer(
                bytearray(blob[base + t["scales_offset"]:base + t["scales_offset"] + rows * 4]),
                dtype=torch.float32,
            )
            state[t["name"]] = q.to(torch.float32).view(*shape) * scale[:, None]
        else:
            state[t["name"]] = torch.frombuffer(
                bytearray(blob[base + t["offset"]:base + t["offset"] + count * 4]), dtype=torch.float32,
            ).view(*shape).clone()
    return header, state


def model_from_state(state: dict, cfg: dict, device: str = "cpu") -> GPT:
    model = GPT(GPTConfig(**{**cfg, "dropout": 0.0}))
    missing, unexpected = model.load_state_dict(state, strict=False)
    if unexpected or any(not k.endswith(".attn.mask") for k in missing):
        raise ValueError(f"weights do not match the config (missing={missing}, unexpected={unexpected})")
    model.to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)
    return model


# --------------------------- master blob ---------------------------

def export_master(state_dict: dict, cfg, tokenizer_json: str, special_names: dict) -> bytes:
    """fp16 weights plus the exact tokenizer, so training reproduces phase 1-3
    tokenization byte for byte."""
    buf = io.BytesIO()
    torch.save({
        "model": {k: v.detach().to(torch.float16).cpu() for k, v in serving_state(state_dict).items()},
        "cfg": model_config(cfg),
        "tokenizer_json": tokenizer_json,
        "special_names": dict(special_names),
    }, buf)
    return buf.getvalue()


def read_master(blob: bytes, device: str = "cpu") -> tuple[GPT, str, dict]:
    """(model, tokenizer.json text, special token names)."""
    ckpt = torch.load(io.BytesIO(blob), map_location="cpu", weights_only=True)
    state = {k: v.to(torch.float32) for k, v in ckpt["model"].items()}
    return model_from_state(state, ckpt["cfg"], device), ckpt["tokenizer_json"], ckpt["special_names"]


def install_tokenizer(tokenizer_json: str, special_names: dict) -> None:
    """Point sft's tokenizer globals (used by modeling) at this model's tokenizer."""
    from tokenizers import Tokenizer
    tok = Tokenizer.from_str(tokenizer_json)
    role_ids = {"user": tok.token_to_id(special_names["user"]), "anima": tok.token_to_id(special_names["anima"])}
    eot_id = tok.token_to_id(special_names["endoftext"])
    if eot_id is None or any(v is None for v in role_ids.values()):
        raise ValueError("tokenizer is missing the <|endoftext|>/<|user|>/<|anima|> tokens")
    sft.tok, sft.role_ids, sft.eot_id = tok, role_ids, eot_id


# --------------------------- bundle ---------------------------

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def export_bundle(inference: bytes, master: bytes, cfg) -> bytes:
    header = {
        "format": BUNDLE_FORMAT,
        "config": model_config(cfg),
        "parts": [
            {"name": "inference", "bytes": len(inference), "sha256": sha256(inference)},
            {"name": "master", "bytes": len(master), "sha256": sha256(master)},
        ],
    }
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return BUNDLE_MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + inference + master


def read_bundle(blob: bytes) -> dict:
    if blob[:8] != BUNDLE_MAGIC:
        raise ValueError("not an anima-model bundle")
    (header_len,) = struct.unpack_from("<I", blob, 8)
    header = json.loads(blob[12:12 + header_len].decode("utf-8"))
    offset = 12 + header_len
    parts = {}
    for part in header["parts"]:
        data = blob[offset:offset + part["bytes"]]
        if sha256(data) != part["sha256"]:
            raise ValueError(f"bundle part {part['name']} is corrupt")
        parts[part["name"]] = data
        offset += part["bytes"]
    return {"header": header, **parts}


def special_ids(tok, meta: dict) -> dict:
    special = meta["special"]
    return {
        "eot": tok.token_to_id(special["endoftext"]),
        "user": tok.token_to_id(special["user"]),
        "anima": tok.token_to_id(special["anima"]),
    }
