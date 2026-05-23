"""Extract structured JSON artifacts from managed-agent text output."""

from __future__ import annotations

import json
import re
from typing import Any


JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)


def extract_json_payload(text: str) -> dict[str, Any]:
    """Extract the first valid JSON object containing signals/opportunities."""
    value = extract_json_object(text, required_any=("signals", "opportunities"))
    if value:
        value.setdefault("signals", [])
        value.setdefault("opportunities", [])
        return value

    return {"signals": [], "opportunities": []}


def extract_json_object(text: str, required_any: tuple[str, ...] = ()) -> dict[str, Any]:
    """Extract the first valid JSON object matching one of the required keys."""
    candidates = [match.group(1) for match in JSON_FENCE_RE.finditer(text)]
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        candidates.append(stripped)

    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict):
            continue
        if not required_any or any(key in value for key in required_any):
            return value

    return {}
