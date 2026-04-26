import asyncio
import contextlib
from dataclasses import dataclass
from typing import Dict, Optional
from uuid import uuid4

from app.collectors.domain import DomainCollector
from app.collectors.email import EmailCollector
from app.collectors.image_metadata import ImageMetadataCollector
from app.collectors.username import UsernameCollector
from app.models.osint import CorrelationResult
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


@dataclass
class PipelineJob:
    job_id: str
    status: str
    input_type: str
    value: str
    source_label: str
    result: Optional[dict] = None
    error: Optional[str] = None


class PipelineManager:
    def __init__(self, graph: GraphStore, vector: VectorStore, workers: int = 2, maxsize: int = 512):
        self.graph = graph
        self.vector = vector
        self._workers = workers
        self._queue: asyncio.Queue[str] = asyncio.Queue(maxsize=maxsize)
        self._jobs: Dict[str, PipelineJob] = {}
        self._tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        if self._tasks:
            return
        self._tasks = [asyncio.create_task(self._worker()) for _ in range(self._workers)]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()

    async def enqueue(self, input_type: str, value: str, source_label: str = "manual") -> PipelineJob:
        job = PipelineJob(
            job_id=uuid4().hex,
            status="queued",
            input_type=input_type,
            value=value,
            source_label=source_label,
        )
        self._jobs[job.job_id] = job
        await self._queue.put(job.job_id)
        return job

    def get_job(self, job_id: str) -> Optional[PipelineJob]:
        return self._jobs.get(job_id)

    async def run_sync(self, input_type: str, value: str, source_label: str = "manual") -> CorrelationResult:
        return await run_ingest_pipeline(self.graph, self.vector, input_type=input_type, value=value, source_label=source_label)

    async def _worker(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs[job_id]
            job.status = "processing"
            try:
                result = await self.run_sync(job.input_type, job.value, job.source_label)
                job.status = "completed"
                job.result = result.model_dump()
            except Exception as exc:  # pragma: no cover - defensive worker boundary
                job.status = "failed"
                job.error = str(exc)
            finally:
                self._queue.task_done()


async def run_ingest_pipeline(graph: GraphStore, vector: VectorStore, input_type: str, value: str, source_label: str = "manual") -> CorrelationResult:
    collector = COLLECTORS.get(input_type)
    if not collector:
        raise ValueError(f"Unsupported input type: {input_type}")

    await publish_event("osint.raw", {"type": input_type, "value": value, "source_label": source_label}, key=value)

    collected_entities = await collector.collect(value=value, source_label=source_label)
    correlation = correlate_entities(collected_entities)

    await publish_event("osint.enriched", correlation.model_dump(), key=correlation.profile_id)

    await asyncio.gather(
        graph.upsert_correlation(correlation),
        vector.upsert_profile(correlation),
    )

    await publish_event("osint.profile", correlation.model_dump(), key=correlation.profile_id)

    return correlation
