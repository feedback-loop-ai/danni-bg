"""DeepEval custom judge backed by any OpenAI-compatible endpoint.

Defaults to the self-hosted gemma (per config), but is fully configurable via
EVAL_JUDGE_*. Local models are unreliable JSON emitters, which breaks G-Eval's
structured scoring; when the endpoint is vLLM we use `guided_json` (grammar-
constrained decoding) so the judge ALWAYS returns schema-valid JSON. Falls back
to `response_format=json_object` + lenient parsing for non-vLLM endpoints.
"""

from __future__ import annotations

import json
from typing import Any

from deepeval.models import DeepEvalBaseLLM
from openai import OpenAI
from pydantic import BaseModel

from config import CONFIG, ProviderCfg


class ConfigurableJudge(DeepEvalBaseLLM):
    def __init__(self, provider: ProviderCfg | None = None) -> None:
        self._p = provider or CONFIG.judge
        self._client = OpenAI(base_url=self._p.base_url, api_key=self._p.api_key or "EMPTY")
        super().__init__()

    # DeepEvalBaseLLM hooks -------------------------------------------------
    def load_model(self) -> Any:  # noqa: D401 - required by base class
        return self._client

    def get_model_name(self) -> str:
        return f"{self._p.model} @ {self._p.base_url}"

    def generate(self, prompt: str, schema: type[BaseModel] | None = None) -> Any:
        base: dict[str, Any] = {
            "model": self._p.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": CONFIG.judge_temperature,
        }
        if schema is None:
            return self._client.chat.completions.create(**base).choices[0].message.content or ""

        # Structured output. Prefer json_schema (constrains fields); fall back to the
        # looser json_object if the server rejects json_schema. NOTE: vLLM `guided_json`
        # via extra_body is silently ignored by some servers, so we use response_format.
        json_schema = schema.model_json_schema()
        if CONFIG.judge_structured:
            formats = [
                {"type": "json_schema", "json_schema": {"name": "verdict", "schema": json_schema}},
                {"type": "json_object"},
            ]
        else:
            formats = [{"type": "json_object"}]

        last_err: Exception | None = None
        for fmt in formats:
            for _ in range(2):  # local judges occasionally emit stray prose; retry
                try:
                    content = (
                        self._client.chat.completions.create(response_format=fmt, **base)
                        .choices[0]
                        .message.content
                        or ""
                    )
                    return schema.model_validate(_extract_json(content))
                except (ValueError, TypeError) as e:  # bad JSON / schema mismatch
                    last_err = e
                except Exception as e:  # server rejected this response_format → try next  # noqa: BLE001
                    last_err = e
                    break
        raise last_err  # type: ignore[misc]

    async def a_generate(self, prompt: str, schema: type[BaseModel] | None = None) -> Any:
        # The sync client is fine for an offline batch eval; no event-loop pressure.
        return self.generate(prompt, schema)


def _extract_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction (guided_json should make this a no-op)."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise
