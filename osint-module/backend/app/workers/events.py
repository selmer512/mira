from app.core.config import settings

async def publish_event(topic: str, payload: dict):
    # Starter placeholder.
    # Production implementation should use aiokafka.AIOKafkaProducer.
    # Keep events JSON serializable and include source, timestamp, and correlation IDs.
    return {"topic": topic, "payload": payload, "brokers": settings.redpanda_brokers}
