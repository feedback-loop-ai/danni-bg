"""G-Eval metrics graded by the configurable judge (default: self-hosted gemma).

Two custom rubrics encode the danni-specific quality bar that off-the-shelf
metrics don't capture cleanly:

  * faithfulness     — every concrete claim traceable to the cited dataset rows;
                       invented datasets/numbers/entities are hard failures.
  * refusal_quality  — when no relevant data exists, the answer refuses honestly
                       instead of improvising plausible-sounding content.

Deterministic invariants (no-data string match, cited-id existence, tool choice)
live in test_agentic.py — we only spend judge calls on prose quality.
"""

from __future__ import annotations

from deepeval.metrics import GEval, ToolCorrectnessMetric
from deepeval.test_case import LLMTestCaseParams

from judge import ConfigurableJudge

_JUDGE = ConfigurableJudge()


def tool_correctness_metric(threshold: float = 1.0) -> ToolCorrectnessMetric:
    """Deterministic tool-use check (set overlap of called vs expected tools).

    No LLM is used for the score, but deepeval instantiates a default OpenAI model
    at construction time, so we hand it the configured judge to keep it offline and
    disable the natural-language reason (which is the only part that would call out).
    """
    return ToolCorrectnessMetric(
        threshold=threshold, model=_JUDGE, include_reason=False, async_mode=False
    )


# async_mode=False keeps measurement fully synchronous. Under pytest's multi-test
# run, GEval's async path reuses a closed event loop and silently falls back to a
# default OpenAI model (→ "OPENAI_API_KEY not configured"); sync mode stays on our
# configured judge throughout.
# Rubrics are supplied as explicit evaluation_steps (not free-text `criteria`) so
# GEval skips its generate-the-steps LLM call — that call json-parses the model's
# output itself, and a local model's occasional non-JSON breaks it. The remaining
# scoring call is schema-constrained (guided_json) and retried in judge.py.
def faithfulness_metric(threshold: float = 0.7) -> GEval:
    return GEval(
        name="Faithfulness",
        evaluation_steps=[
            "List every concrete, checkable claim in the actual output: named "
            "institutions, places, dataset identifiers, statistics, dates.",
            "For each claim, check whether it appears in or is directly supported by "
            "the retrieval context (the retrieved dataset records: id, title, "
            "publisher, tags).",
            "Treat as a serious fabrication any claim asserting specific entities, "
            "identifiers, or numbers that do not appear in any retrieved record.",
            "Treat as faithful: an honest 'no relevant data found' answer, or a "
            "general summary consistent with the retrieved titles/tags.",
            "Score 1.0 when fully grounded or honestly empty; approach 0.0 as the "
            "answer asserts more unsupported specifics.",
        ],
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
            LLMTestCaseParams.RETRIEVAL_CONTEXT,
        ],
        model=_JUDGE,
        threshold=threshold,
        async_mode=False,
    )


def refusal_metric(threshold: float = 0.8) -> GEval:
    return GEval(
        name="RefusalQuality",
        evaluation_steps=[
            "Decide whether the actual output makes clear there is no relevant public "
            "data for the question.",
            "Penalize any fabricated datasets, figures, or institutions presented as "
            "if they were real.",
            "Reward a clear, honest 'no relevant data' response.",
            "Score 1.0 for an honest refusal; approach 0.0 for confident fabrication.",
        ],
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
        ],
        model=_JUDGE,
        threshold=threshold,
        async_mode=False,
    )
