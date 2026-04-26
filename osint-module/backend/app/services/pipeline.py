from app.collectors.username import UsernameCollector
from app.collectors.email import EmailCollector
from app.collectors.domain import DomainCollector
from app.collectors.image_metadata import ImageMetadataCollector
from app.services.correlation import correlate_entities
from app.services.graph_store import GraphStore
from app.services.vector_store import VectorStore
from app.workers.events import publish_event

COLLECTORS = {
    "username": UsernameCollector(),
    "email": EmailCollector(),
    "domain": DomainCollector(),
    "image": ImageMetadataCollector(),
}

async def run_ingest_pipeline(input_type: str, value: str, source_label: str = "manual"):
    collector = COLLECTORS.get(input_type)
    if not collector:
        raise ValueError(f"Unsupported input type: {input_type}")

    await publish_event("osint.raw", {"type": input_type, "value": value, "source_label": source_label})

    collected_entities = await collector.collect(value=value, source_label=source_label)
    correlation = correlate_entities(collected_entities)

    graph = GraphStore()
    await graph.upsert_correlation(correlation)

    vector = VectorStore()
    await vector.upsert_profile(correlation)

    await publish_event("osint.profile", correlation.model_dump())

    return correlation.model_dump()
