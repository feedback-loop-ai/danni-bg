"""Pytest fixtures + preflight for the agentic eval suite.

Skips the whole suite (rather than erroring) when the chat API isn't reachable,
so a missing server is a clear "start the API" message, not a stack trace.
"""

from __future__ import annotations

import httpx
import pytest

from config import CONFIG


def pytest_collection_modifyitems(config, items):  # noqa: ARG001
    """Probe the API once; if down, mark everything skipped with a clear reason."""
    url = f"{CONFIG.api_base_url.rstrip('/')}/api/health"
    try:
        httpx.get(url, timeout=5.0).raise_for_status()
    except Exception as e:  # noqa: BLE001
        skip = pytest.mark.skip(
            reason=(
                f"chat API not reachable at {CONFIG.api_base_url} ({e}). "
                "Start it with `bun run explorer:api`."
            )
        )
        for item in items:
            item.add_marker(skip)
