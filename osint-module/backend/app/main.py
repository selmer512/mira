from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app.api.osint import router as osint_router
from app.core.config import settings
from app.services.graph_store import GraphStore
from app.services.pipeline import PipelineManager
from app.services.vector_store import VectorStore
from app.workers.events import event_bus


@asynccontextmanager
async def lifespan(app: FastAPI):
    graph = GraphStore()
    vector = VectorStore()
    pipeline = PipelineManager(
        graph=graph,
        vector=vector,
        workers=settings.pipeline_workers,
        maxsize=settings.pipeline_queue_size,
    )

    await event_bus.start()
    await pipeline.start()

    app.state.graph = graph
    app.state.vector = vector
    app.state.pipeline = pipeline

    yield

    await pipeline.stop()
    await vector.close()
    await graph.close()
    await event_bus.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True, "service": settings.app_name}


@app.get("/health/dependencies")
async def dependency_health():
    graph_ok = await app.state.graph.healthcheck()
    vector_ok = await app.state.vector.healthcheck()
    return {"neo4j": graph_ok, "qdrant": vector_ok, "redpanda": True}


app.include_router(osint_router, prefix="/api/osint", tags=["osint"])


@app.get("/")
async def home():
    return RedirectResponse(url="/api/osint/ui")
