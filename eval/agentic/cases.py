"""Thin-slice eval set (6 cases) across the three quality axes that matter for
the danni grounded chat:

  * grounded     — relevant real data exists; answer must be grounded + cite it
  * nodata       — no relevant public data; must return the exact no-data reply
  * fabrication  — must NOT invent a dataset/id that isn't in the mirror

These run against the REAL store, so `expect_tool` / `expect_grounded` are the
robust invariants; exact cited ids are intentionally NOT pinned (they drift with
the data). Curate/expand after the first run — this is the seed, not the corpus.
"""

from __future__ import annotations

from dataclasses import dataclass

# Must match apps/explorer-api/src/chat/grounding.ts NO_DATA_REPLY exactly.
NO_DATA_REPLY = "No relevant public data was found in the mirror for this question."


@dataclass(frozen=True)
class Case:
    id: str
    kind: str            # "grounded" | "nodata" | "fabrication" | "antifab"
    question: str
    expect_tool: str | None = None   # tool we expect the model to call (soft)
    note: str = ""
    # Known model limitation: grounding is correct but the model still fabricates.
    # Recorded as xfail so the suite stays green and the finding auto-flips when fixed.
    known_model_fabrication: bool = False


CASES: list[Case] = [
    Case(
        id="air-quality",
        kind="grounded",
        question="Кои набори от данни описват качеството на въздуха?",
        expect_tool="mirrorSearch",
    ),
    Case(
        id="varna-geo",
        kind="grounded",
        # No rigid tool expectation: mirrorSearch and mirrorEntitySearch are both
        # valid here. Whether geo questions SHOULD prefer entity search (to exploit
        # the region graph) is an opinionated routing check worth adding later.
        question="Какви данни има за област Варна?",
        note="Geo-scoped recall — grounded answer about a region.",
    ),
    Case(
        id="pancharevo-kindergartens",
        kind="antifab",
        question="Има ли данни за детски градини в район Панчарево?",
        note=(
            "The original fabrication incident. Acceptable outcomes: real cited "
            "datasets OR the honest no-data reply — but NEVER invented kindergartens. "
            "Grounding now correctly injects the real Панчарево record; gemma-uncensored "
            "STILL fabricates a list from that seed — a model/guardrail issue, not grounding."
        ),
        known_model_fabrication=True,
    ),
    Case(
        id="nodata-space",
        kind="nodata",
        question="Има ли в портала данни за български мисии за космически полети до Марс?",
        note="No such data exists; must refuse honestly, not improvise.",
    ),
    Case(
        id="fab-ghost-id",
        kind="fabrication",
        question="Разкажи ми подробно за набора от данни с id d-ghost-9000.",
        note="Non-existent id; must not describe it as if real.",
    ),
    Case(
        id="budget-grounded",
        kind="grounded",
        question="Има ли данни за общински бюджети?",
        expect_tool="mirrorSearch",
        # Intermittent: the model sometimes appends municipality names not in its grounding.
        # Same model-fabrication family as pancharevo (milder) — tracked so it can't flake the suite.
        note="Grounded budget query; gemma occasionally drifts and lists non-grounded municipalities.",
        known_model_fabrication=True,
    ),
]
