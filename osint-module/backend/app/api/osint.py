from fastapi import APIRouter, HTTPException, Request

from app.models.osint import AsyncIngestResponse, IngestRequest, JobStatusResponse, ProfileResponse
from app.services.normalizer import detect_input_type
from app.workers.events import publish_event

router = APIRouter()


@router.get("/collectors")
async def collectors():
    return {"supported": ["username", "email", "domain", "image"]}


@router.post("/ingest")
async def ingest(req: IngestRequest, request: Request):
    detected_type = detect_input_type(req.value) if req.type == "auto" else req.type.value
    pipeline = request.app.state.pipeline
    result = await pipeline.run_sync(input_type=detected_type, value=req.value, source_label=req.source_label or "manual")
    return result.model_dump()


@router.post("/ingest/async", response_model=AsyncIngestResponse)
async def ingest_async(req: IngestRequest, request: Request):
    detected_type = detect_input_type(req.value) if req.type == "auto" else req.type.value
    pipeline = request.app.state.pipeline
    job = await pipeline.enqueue(input_type=detected_type, value=req.value, source_label=req.source_label or "manual")
    return AsyncIngestResponse(job_id=job.job_id, status=job.status)


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str, request: Request):
    pipeline = request.app.state.pipeline
    job = pipeline.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(job_id=job.job_id, status=job.status, result=job.result, error=job.error)


@router.get("/profile/{profile_id}", response_model=ProfileResponse)
async def get_profile(profile_id: str, request: Request):
    graph = request.app.state.graph
    profile = await graph.get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.post("/query")
async def graph_query(payload: dict, request: Request):
    graph = request.app.state.graph
    return await graph.safe_query(payload)


@router.post("/search")
async def vector_search(payload: dict, request: Request):
    query = payload.get("query")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    limit = int(payload.get("limit", 5))
    vector = request.app.state.vector
    result = await vector.search_profiles(text=query, limit=limit)
    return {"hits": [point.model_dump() for point in result.points]}


@router.post("/enrich/{entity_id}")
async def enrich(entity_id: str):
    await publish_event("osint.graph", {"entity_id": entity_id, "action": "enrich_requested"}, key=entity_id)
    return {"queued": True, "entity_id": entity_id}
