import asyncio

import pytest

from app.services import pipeline


class SlowCollector:
    async def collect(self, value: str, source_label: str = "manual"):
        await asyncio.sleep(1)
        return []


@pytest.mark.asyncio
async def test_run_ingest_pipeline_applies_collector_timeout(monkeypatch):
    monkeypatch.setitem(pipeline.COLLECTORS, "slow", SlowCollector())
    monkeypatch.setattr(pipeline.settings, "collector_timeout_seconds", 0.01)

    async def noop_publish(*args, **kwargs):
        return None

    monkeypatch.setattr(pipeline, "publish_event", noop_publish)

    with pytest.raises(TimeoutError):
        await pipeline.run_ingest_pipeline(
            graph=object(),
            vector=object(),
            input_type="slow",
            value="value",
        )
