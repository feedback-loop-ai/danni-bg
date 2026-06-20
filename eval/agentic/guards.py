"""Deterministic grounding guards — the anti-fabrication checks that DON'T need an
LLM judge, and so can't be fooled by a weak one.

A small LAN judge (gemma-26b) proved unreliable on long enumerations: it both
over-flags faithful answers (calling grounded datasets "fabricated") and would
miss the one failure mode the chat genuinely exhibits intermittently — inflating
a dataset count ("над 40 набора" when only ~30 were grounded). These two checks
catch that mode mechanically, independent of any judge:

  1. ghost ids   — every dataset id stated in the answer must appear in the exact
                   grounding context the server injected (the debug `grounding`
                   event). An id that isn't there was invented.
  2. count claim — a "над N набора" / "over N datasets" claim must not exceed the
                   number of datasets actually grounded.

They complement (not replace) the G-Eval faithfulness metric.
"""

from __future__ import annotations

import re

# Dataset ids are UUIDs in the grounding payload and any honest citation in prose.
_UUID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)

# "над 40 набора", "повече от 30 набора данни", "over 40 datasets", "more than 25 sets".
# Bounded to the same clause (no newline / sentence end) so "над 24 часа" (a staleness
# note) or "над 40 г." (a year) can't trigger it — the number must lead to a data noun.
_COUNT = re.compile(
    r"(?:над|повече от|over|more than)\s+(\d+)[^\n.]{0,25}?(?:набор|данни|dataset)",
    re.IGNORECASE,
)
# "40+ набора", "30+ datasets"
_COUNT_PLUS = re.compile(r"\b(\d+)\s*\+[^\n.]{0,25}?(?:набор|данни|dataset)", re.IGNORECASE)


def grounding_ids(grounding_text: str | None) -> set[str]:
    """The set of dataset ids (lowercased) the server actually injected."""
    return {m.lower() for m in _UUID.findall(grounding_text or "")}


def grounding_violations(answer: str, grounding_text: str | None) -> list[str]:
    """Return human-readable violations; empty list = clean. Pure + deterministic."""
    violations: list[str] = []
    grounded = grounding_ids(grounding_text)

    # (1) ghost ids — a uuid in the answer that the model was never shown.
    for did in sorted({m.lower() for m in _UUID.findall(answer or "")}):
        if did not in grounded:
            violations.append(f"dataset id {did} stated in answer but absent from grounding")

    # (2) inflated count — claiming more datasets than were grounded.
    cap = len(grounded)
    claims = [int(n) for n in _COUNT.findall(answer or "")]
    claims += [int(n) for n in _COUNT_PLUS.findall(answer or "")]
    for n in claims:
        if n > cap:
            violations.append(f"claims '{n}' datasets but only {cap} were grounded")

    return violations
