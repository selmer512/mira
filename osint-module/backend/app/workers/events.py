import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from aiokafka import AIOKafkaProducer

from app.core.config import settings

logger = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self._producer: Optional[AIOKafkaProducer] = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._producer:
            return
        async with self._lock:
            if self._producer:
                return
            producer = AIOKafkaProducer(
                bootstrap_servers=settings.redpanda_brokers,
                client_id=settings.kafka_client_id,
                compression_type="gzip",
                linger_ms=10,
                max_batch_size=131072,
                request_timeout_ms=settings.kafka_request_timeout_ms,
                retries=5,
                acks="all",
                value_serializer=lambda payload: json.dumps(payload, default=str).encode("utf-8"),
            )
            await producer.start()
            self._producer = producer
            logger.info("Event bus started")

    async def stop(self) -> None:
        if not self._producer:
            return
        async with self._lock:
            if self._producer:
                await self._producer.stop()
                self._producer = None
                logger.info("Event bus stopped")

    async def publish(self, topic: str, payload: dict, key: Optional[str] = None) -> None:
        await self.start()
        enriched_payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": settings.app_name,
            **payload,
        }
        key_bytes = key.encode("utf-8") if key else None
        assert self._producer is not None
        await self._producer.send_and_wait(topic, enriched_payload, key=key_bytes)


event_bus = EventBus()


async def publish_event(topic: str, payload: dict, key: Optional[str] = None):
    await event_bus.publish(topic=topic, payload=payload, key=key)
