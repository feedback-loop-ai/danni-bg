"""Eval set across the quality axes that matter for the danni grounded chat:

  * grounded     — relevant real data exists; answer must be grounded + cite it
  * nodata       — no relevant public data; must return the exact no-data reply
  * fabrication  — must NOT invent a dataset/id that isn't in the mirror

These run against the REAL store, so `expect_tool` / `expect_grounded` are the
robust invariants; exact cited ids are intentionally NOT pinned (they drift with
the data).

**Enumeration cases** (`enum: True`): broad topics that legitimately retrieve many
datasets (registers, municipalities, a whole oblast, …). These are where the chat
historically drifts — inflating a count ("над 40 набора") or inventing dataset
ids/rows beyond the grounding. They're picked from the corpus's largest facet
buckets (регистър ~4000, община ~3300, пуп ~160) so they reliably enumerate, and
they're the primary load for the judge-independent guards in guards.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field

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
    # Enumeration case: a broad topic that retrieves many datasets — the load that
    # stresses count-inflation / ghost-id drift (see guards.py + the module docstring).
    enum: bool = False
    # Optional chat scope (e.g. {"geoUnitIds": [...]}) sent with the turn, exercising
    # the geo-scope roll-up + scope-aware recall (spec 023, FR-099/FR-100). The chat
    # never sees the scope as text — it's a server-side filter — so the QUESTION must
    # stand on its own and not lean on the scope for its referent.
    scope: dict | None = field(default=None)


CASES: list[Case] = [
    Case(
        id="air-quality",
        kind="grounded",
        question="Кои набори от данни описват качеството на въздуха?",
        expect_tool="mirrorSearch",
        enum=True,
    ),
    Case(
        id="varna-geo",
        kind="grounded",
        # No rigid tool expectation: mirrorSearch and mirrorEntitySearch are both
        # valid here. Whether geo questions SHOULD prefer entity search (to exploit
        # the region graph) is an opinionated routing check worth adding later.
        question="Какви данни има за област Варна?",
        note="Geo-scoped recall — grounded answer about a region.",
        enum=True,
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
        enum=True,
    ),
    # --- Enumeration cases -----------------------------------------------------------
    # Broad topics that retrieve many datasets — the load that stresses count inflation
    # and ghost-id drift. Backed by the corpus's largest facet buckets so they reliably
    # enumerate; graded for faithfulness + the deterministic guards (guards.py).
    Case(
        id="registers-enum",
        kind="grounded",
        question="Какви публични регистри има в портала?",
        expect_tool="mirrorSearch",
        note="Largest facet bucket (регистър ~4000): a long, multi-publisher enumeration.",
        enum=True,
    ),
    Case(
        id="municipalities-enum",
        kind="grounded",
        question="Какви данни публикуват общините?",
        expect_tool="mirrorSearch",
        note="общ* ~3300 datasets: must enumerate without inventing municipality entries.",
        enum=True,
    ),
    Case(
        id="plovdiv-geo-enum",
        kind="grounded",
        # Geo enumeration over a second large oblast (cf. varna-geo) — either mirror tool is valid.
        question="Какви данни има за област Пловдив?",
        note="Second-oblast geo recall; broad list across publishers and municipalities.",
        enum=True,
    ),
    Case(
        id="pup-enum",
        kind="grounded",
        question="Има ли данни за подробни устройствени планове (ПУП)?",
        expect_tool="mirrorSearch",
        note="пуп ~160: domain-specific enumeration (urban-planning registers).",
        enum=True,
    ),
    Case(
        id="population-enum",
        kind="grounded",
        # НСИ population datasets reliably surface (they appear in varna-geo's grounding too).
        question="Какви демографски данни за населението в България има?",
        expect_tool="mirrorSearch",
        note="NSI demographics: national statistical massives, several per query.",
        enum=True,
    ),
    # --- Geo-scoped cases (spec 023): the turn carries scope.geoUnitIds, exercising the oblast→
    # municipality roll-up + scope-aware recall. The chat can't see the scope, so each question
    # names its own subject and must still ground within the scoped region. ---
    Case(
        id="geo-scope-recall",
        kind="grounded",
        # Generic topic scoped to one oblast — the case that used to starve (0 citations / 30
        # floundering searches) before scope-aware over-fetch + region backfill (FR-100).
        question="Изброй набори от данни за регистри.",
        expect_tool="mirrorSearch",
        scope={"geoUnitIds": ["geo:bg-oblast-stara-zagora"]},
        note=(
            "Scope-aware recall: a generic query under a tight oblast scope must retrieve the region "
            "(FR-100) AND stay in-region — the model must not pad the list with out-of-region "
            "institutions. The GEO_SCOPE_NOTE guardrail (FR-101) hard-stops that cross-region "
            "fabrication; faithfulness now passes outright (was an xfail before the guardrail)."
        ),
        enum=True,
    ),
    Case(
        id="geo-scope-municipality-rollup",
        kind="grounded",
        # Scoped to the OBLAST but asking about a municipality within it — only grounds if the oblast
        # scope was rolled up to include its municipalities (FR-099). A flat oblast scope excludes it.
        question="Какви данни публикува община Казанлък?",
        expect_tool="mirrorSearch",
        scope={"geoUnitIds": ["geo:bg-oblast-stara-zagora"]},
        note="Oblast scope must include municipality data (roll-up) to answer a municipality question.",
    ),
]
