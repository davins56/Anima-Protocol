# Anima Protocol — Ollama Modelfile defaults for the own model.
#
# The same file format `ollama create` reads, so a tuned Modelfile can move
# between an Ollama host and this server. Supported instructions:
#
#   PARAMETER <name> <value>   sampler defaults (temperature, top_k, top_p,
#                              min_p, repeat_penalty, repeat_last_n, seed,
#                              num_predict, num_ctx, stop, ...). `stop` may
#                              repeat; each line adds one stop string.
#   SYSTEM <text>              used when a request carries no system message
#   MESSAGE <role> <text>      example turns placed before the conversation
#
# FROM, TEMPLATE, ADAPTER and LICENSE are read and kept for /api/show but do
# not change serving: the weights are this server's checkpoint and the prompt
# layout is the one SFT trained on. Text values may be quoted with "…" or,
# across lines, with """…""". Lines starting with # are comments.

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DEFAULT_PATH = HERE / "Modelfile"
KNOWN = {"FROM", "PARAMETER", "SYSTEM", "MESSAGE", "TEMPLATE", "ADAPTER", "LICENSE"}
MESSAGE_ROLES = {"system", "user", "assistant"}


class ModelfileError(ValueError):
    pass


@dataclass
class Modelfile:
    source: str = ""
    path: str | None = None
    base: str | None = None
    parameters: dict[str, Any] = field(default_factory=dict)
    system: str | None = None
    messages: list[dict[str, str]] = field(default_factory=list)
    template: str | None = None

    def parameter_lines(self) -> str:
        """PARAMETER lines in the format /api/show returns."""
        lines = []
        for name, value in self.parameters.items():
            for item in value if isinstance(value, list) else [value]:
                shown = f'"{item}"' if isinstance(item, str) else item
                lines.append(f"{name:<20}{shown}")
        return "\n".join(lines)


def _value(raw: str):
    text = raw.strip()
    if len(text) >= 2 and text[0] == text[-1] == '"':
        return text[1:-1]
    for cast in (int, float):
        try:
            return cast(text)
        except ValueError:
            continue
    return text


def _split_blocks(text: str):
    """Yield (instruction, argument) pairs, joining triple-quoted values."""
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line or line.startswith("#"):
            continue
        head, _, rest = line.partition(" ")
        keyword = head.upper()
        rest = rest.strip()
        if '"""' in rest:
            before, _, after = rest.partition('"""')
            if '"""' in after:
                body, _, _ = after.partition('"""')
            else:
                parts = [after]
                while i < len(lines):
                    chunk = lines[i]
                    i += 1
                    if '"""' in chunk:
                        parts.append(chunk.partition('"""')[0])
                        break
                    parts.append(chunk)
                else:
                    raise ModelfileError(f'{keyword}: unterminated """ block')
                body = "\n".join(parts)
            rest = f"{before}{body}" if before.strip() else body
            yield keyword, rest, True
            continue
        yield keyword, rest, False


def parse(text: str, path: str | None = None) -> Modelfile:
    out = Modelfile(source=text, path=path)
    for keyword, rest, quoted in _split_blocks(text):
        if keyword not in KNOWN:
            raise ModelfileError(f"unknown instruction: {keyword}")
        if keyword == "FROM":
            out.base = rest
        elif keyword == "PARAMETER":
            name, _, raw = rest.partition(" ")
            name = name.strip().lower()
            if not name or not raw.strip():
                raise ModelfileError(f"PARAMETER needs a name and a value: {rest!r}")
            value = raw if quoted else _value(raw)
            if name == "stop":
                out.parameters.setdefault("stop", []).append(str(value))
            else:
                out.parameters[name] = value
        elif keyword == "SYSTEM":
            out.system = rest if quoted else str(_value(rest))
        elif keyword == "MESSAGE":
            role, _, content = rest.partition(" ")
            role = role.strip().lower()
            if role not in MESSAGE_ROLES:
                raise ModelfileError(f"MESSAGE role must be system, user or assistant: {role!r}")
            out.messages.append({"role": role, "content": content.strip() if quoted else str(_value(content))})
        elif keyword == "TEMPLATE":
            out.template = rest
    return out


def load(path: str | None = None) -> Modelfile:
    """The Modelfile at ANIMA_MODELFILE, else server/Modelfile, else empty.

    ANIMA_MODELFILE=off serves with the built-in defaults only.
    """
    chosen = path if path is not None else os.environ.get("ANIMA_MODELFILE", "").strip()
    if chosen.lower() in {"off", "none", "0", "false"}:
        return Modelfile()
    target = Path(chosen) if chosen else DEFAULT_PATH
    if not target.is_file():
        if chosen:
            raise SystemExit(f"ANIMA_MODELFILE not found: {target}")
        return Modelfile()
    return parse(target.read_text(encoding="utf-8"), str(target))
