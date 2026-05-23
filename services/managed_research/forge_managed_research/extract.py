"""Extract structured JSON artifacts from managed-agent text output."""

from __future__ import annotations

import json
import re
from typing import Any


JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)


def extract_json_payload(text: str) -> dict[str, Any]:
    """Extract the first valid JSON object containing signals/opportunities."""
    candidates = [match.group(1) for match in JSON_FENCE_RE.finditer(text)]
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        candidates.append(stripped)

    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and ("signals" in value or "opportunities" in value):
            value.setdefault("signals", [])
            value.setdefault("opportunities", [])
            return value

    return {"signals": [], "opportunities": []}

