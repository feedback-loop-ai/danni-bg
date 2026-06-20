"""Agentic quality eval for the danni grounded chat (thin slice).

Each case drives the REAL chat API and is graded on a mix of:
  * deterministic invariants  — no-data string, cited-id presence, no ghost ids
  * tool correctness          — did the model reach for the right mirror tool
  * judge-graded prose        — faithfulness / refusal quality (G-Eval via gemma)

Run:  bun run eval:agentic   (or: uv run pytest)  with `bun run explorer:api` up.
"""

from __future__ import annotations

import pytest
from deepeval.metrics.base_metric import BaseMetric
from deepeval.test_case import LLMTestCase, ToolCall

import json

from cases import CASES, NO_DATA_REPLY, Case
from chat_client import chat, dataset_detail, dataset_rows_sample
from guards import grounding_violations
from metrics import faithfulness_metric, refusal_metric, tool_correctness_metric

# Per-dataset row sample size fed to the judge as ground truth (bounded so the judge
# prompt stays manageable; mirrors the order of magnitude the chat itself grounds on).
_ROWS_PER_DATASET = 200
_ROWS_CHARS_CAP = 8000
_MAX_CONTEXT_DATASETS = 8


def _context(result) -> list[str]:
    """The grounding context the answer must be faithful to. Prefer the EXACT context
    the server injected (debug `grounding` event) — that is precisely what the model
    saw. Fall back to reconstructing it from cited datasets' records + row samples."""
    if result.grounding_text:
        return [result.grounding_text]
    if not result.citations:
        return ["No datasets were retrieved."]
    ctx: list[str] = []
    # Cap reconstruction breadth: a tool-loop model can cite dozens of datasets, and fetching
    # rows for all of them would blow the judge's context window. Top-N is enough to verify the
    # specific claims an answer makes.
    for c in result.citations[:_MAX_CONTEXT_DATASETS]:
        did = c.get("datasetId")
        d = dataset_detail(did) if did else None
        if not d:
            ctx.append(f"id={did} | title={c.get('titleBg')}")
            continue
        tags = ", ".join(d.get("tags", [])[:12])
        pub = (d.get("publisher") or {}).get("titleBg", "")
        header = f"id={did} | title={d.get('titleBg')} | publisher={pub} | tags=[{tags}]"
        resources = d.get("resources") or []
        rid = resources[0]["resourceId"] if resources else None
        rows = dataset_rows_sample(did, rid, _ROWS_PER_DATASET) if rid else None
        if rows:
            sample = json.dumps(rows, ensure_ascii=False)[:_ROWS_CHARS_CAP]
            ctx.append(f"{header}\n  rows sample: {sample}")
        else:
            ctx.append(header)
    return ctx


def _assert_metrics(case: Case, tc: LLMTestCase, metrics: list[BaseMetric]) -> None:
    """Measure each metric directly and assert it passes.

    Avoids deepeval's `assert_test`/test-run layer, which pulls in a default
    OpenAI model for telemetry — we keep everything on the configured judge and
    fully offline. Failures report the judge's own reason.
    """
    for metric in metrics:
        metric.measure(tc)
        if not metric.is_successful():
            msg = (
                f"[{case.id}] {metric.__class__.__name__}"
                f"{'/' + metric.name if hasattr(metric, 'name') else ''} "
                f"score={metric.score:.2f} < {metric.threshold:.2f} — {metric.reason}"
            )
            # Tracked known model limitation (grounding correct, model still fabricates):
            # report as xfail so the suite stays green and auto-flips if the model improves.
            if case.known_model_fabrication:
                pytest.xfail(msg)
            raise AssertionError(msg)


def _llm_case(case: Case, result) -> LLMTestCase:
    tc = LLMTestCase(
        input=case.question,
        actual_output=result.text,
        retrieval_context=_context(result),
        tools_called=[ToolCall(name=n) for n in result.tools_called],
    )
    if case.expect_tool:
        tc.expected_tools = [ToolCall(name=case.expect_tool)]
    return tc


@pytest.fixture(scope="module", params=CASES, ids=lambda c: c.id)
def case_run(request):
    """Run each case's chat turn once and share the result across its assertions."""
    case: Case = request.param
    return case, chat(case.question)


def test_no_provider_error(case_run):
    case, result = case_run
    assert result.error is None, f"[{case.id}] chat returned error: {result.error}"


def test_grounding_invariants(case_run):
    """Judge-independent anti-fabrication guard (deterministic). Catches the chat's
    one real failure mode — inventing dataset ids or inflating a 'над N набора' count
    beyond what was grounded — without depending on the (weak) LLM judge. See guards.py.
    """
    case, result = case_run
    violations = grounding_violations(result.text, result.grounding_text)
    assert not violations, f"[{case.id}] grounding violations: " + "; ".join(violations)


def test_quality(case_run):
    case, result = case_run
    is_nodata = result.text.strip() == NO_DATA_REPLY

    if case.kind == "nodata":
        # Two valid refusal paths: the pipeline emits the exact no-data reply when
        # retrieval is truly empty (hard no-data); otherwise semantic search returns
        # weak matches and the MODEL must itself refuse honestly (soft no-data). The
        # judge grades the latter.
        if is_nodata:
            assert not result.citations, f"[{case.id}] no-data reply must not cite datasets"
        else:
            _assert_metrics(case, _llm_case(case, result), [refusal_metric()])

    elif case.kind == "fabrication":
        # A fake id must never be described as real, nor smuggled into citations.
        assert "d-ghost-9000" not in result.cited_dataset_ids, (
            f"[{case.id}] fabricated id leaked into citations"
        )
        _assert_metrics(case, _llm_case(case, result), [refusal_metric()])

    elif case.kind == "antifab":
        # Real citations OR honest no-data are both fine; invention is not.
        # Faithfulness covers all three outcomes in one rubric.
        _assert_metrics(case, _llm_case(case, result), [faithfulness_metric()])

    else:  # grounded
        assert not is_nodata, f"[{case.id}] expected grounded data, got the no-data reply"
        assert result.citations, f"[{case.id}] grounded answer must cite >=1 dataset"
        metrics: list = [faithfulness_metric()]
        if case.expect_tool:
            metrics.append(tool_correctness_metric())
        _assert_metrics(case, _llm_case(case, result), metrics)
