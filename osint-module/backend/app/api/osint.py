from fastapi import APIRouter, HTTPException
from app.models.osint import IngestRequest, ProfileResponse
from app.services.normalizer import detect_input_type
from app.services.pipeline import run_ingest_pipeline
from app.services.graph_store import GraphStore

router = APIRouter()

@router.post("/ingest")
async def ingest(req: IngestRequest):
    detected_type = detect_input_type(req.value) if req.type == "auto" else req.type.value
    result = await run_ingest_pipeline(input_type=detected_type, value=req.value, source_label=req.source_label)
    return result

@router.get("/profile/{profile_id}", response_model=ProfileResponse)
async def get_profile(profile_id: str):
    graph = GraphStore()
    profile = await graph.get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile

@router.post("/query")
async def graph_query(payload: dict):
    graph = GraphStore()
    return await graph.safe_query(payload)

@router.post("/enrich/{entity_id}")
async def enrich(entity_id: str):
    # Placeholder for async enrichment dispatch.
    return {"queued": True, "entity_id": entity_id}
