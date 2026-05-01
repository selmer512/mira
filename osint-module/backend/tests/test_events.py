import pytest

from app.workers.events import EventBus


class FlakyProducer:
    def __init__(self):
        self.calls = 0

    async def send_and_wait(self, topic, payload, key=None):
        self.calls += 1
        if self.calls < 3:
            raise RuntimeError("temporary broker failure")
        return None


@pytest.mark.asyncio
async def test_publish_retries_with_backoff(monkeypatch):
    producer = FlakyProducer()
    bus = EventBus()
    bus._producer = producer

    async def no_sleep(delay):
        return None

    monkeypatch.setattr("app.workers.events.asyncio.sleep", no_sleep)

    await bus.publish("topic", {"payload": True}, key="key")

    assert producer.calls == 3
