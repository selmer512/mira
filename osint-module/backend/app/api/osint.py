from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.models.osint import AsyncIngestResponse, IngestRequest, JobStatusResponse, ProfileResponse
from app.services.normalizer import detect_input_type
from app.workers.events import publish_event

router = APIRouter()


@router.get("/ui", response_class=HTMLResponse)
async def osint_ui():
    return """
<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>Mira OSINT Console</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
    .card { background: #1e293b; border-radius: 10px; padding: 1rem; margin-bottom: 1rem; }
    input, select, button, textarea { padding: .5rem; margin: .25rem 0; border-radius: 6px; border: 1px solid #334155; }
    input, select, textarea { background: #0b1220; color: #e2e8f0; width: 100%; }
    button { background: #22c55e; color: #06230e; border: none; cursor: pointer; font-weight: 600; }
    pre { background: #020617; padding: .75rem; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Mira OSINT Console</h1>
  <div class=\"card\">
    <h3>Ingest</h3>
    <label>Type</label>
    <select id=\"type\"><option>auto</option><option>username</option><option>email</option><option>domain</option><option>image</option></select>
    <label>Value</label>
    <input id=\"value\" placeholder=\"example_user or example.com\" />
    <label>Source label</label>
    <input id=\"source\" value=\"manual\" />
    <button onclick=\"ingestSync()\">Run Sync Ingest</button>
    <button onclick=\"ingestAsync()\">Queue Async Ingest</button>
  </div>

  <div class=\"card\">
    <h3>Job / Profile / Search</h3>
    <label>Job ID</label><input id=\"job_id\" /><button onclick=\"getJob()\">Check Job</button>
    <label>Profile ID</label><input id=\"profile_id\" /><button onclick=\"getProfile()\">Get Profile</button>
    <label>Search query</label><input id=\"query\" /><button onclick=\"search()\">Vector Search</button>
  </div>

  <div class=\"card\"><h3>Output</h3><pre id=\"out\">Ready.</pre></div>

<script>
const out = document.getElementById('out');
function show(data){ out.textContent = JSON.stringify(data, null, 2); }
function payload(){
  return { type: document.getElementById('type').value, value: document.getElementById('value').value, source_label: document.getElementById('source').value };
}
async function ingestSync(){
  const r = await fetch('/api/osint/ingest', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload())});
  const j = await r.json(); show(j); if (j.profile_id) document.getElementById('profile_id').value = j.profile_id;
}
async function ingestAsync(){
  const r = await fetch('/api/osint/ingest/async', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload())});
  const j = await r.json(); show(j); if (j.job_id) document.getElementById('job_id').value = j.job_id;
}
async function getJob(){
  const id = document.getElementById('job_id').value;
  const r = await fetch(`/api/osint/jobs/${id}`); const j = await r.json(); show(j);
  if (j.result && j.result.profile_id) document.getElementById('profile_id').value = j.result.profile_id;
}
async function getProfile(){
  const id = document.getElementById('profile_id').value;
  const r = await fetch(`/api/osint/profile/${id}`); show(await r.json());
}
async function search(){
  const r = await fetch('/api/osint/search', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({query: document.getElementById('query').value, limit: 5})});
  show(await r.json());
}
</script>
</body>
</html>
    """


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
