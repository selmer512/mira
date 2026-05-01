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
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Mira OSINT</title>
      <style>
        :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        body { margin: 0; background: #f6f7f9; color: #15171a; }
        main { max-width: 1180px; margin: 0 auto; padding: 28px; }
        h1 { font-size: 28px; margin: 0 0 22px; }
        h2 { font-size: 17px; margin: 0 0 14px; }
        section { background: white; border: 1px solid #d8dde5; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
        label { display: block; font-size: 13px; font-weight: 650; margin-bottom: 6px; }
        input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #c9d0da; border-radius: 6px; padding: 10px; font: inherit; background: white; }
        textarea { min-height: 150px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
        .result { min-height: 320px; }
        .grid { display: grid; grid-template-columns: 160px 1fr 160px 160px; gap: 12px; align-items: end; }
        .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .row { display: grid; grid-template-columns: 1fr 160px; gap: 12px; align-items: end; }
        .query-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        button { border: 0; border-radius: 6px; padding: 11px 14px; font: inherit; font-weight: 700; background: #155eef; color: white; cursor: pointer; }
        button.secondary { background: #303846; }
        button.tertiary { background: #0f766e; }
        .muted { color: #5d6675; font-size: 13px; }
        .error { display: none; border-color: #f0b4b4; background: #fff5f5; color: #8a1f1f; }
        @media (max-width: 860px) { .grid, .two-col, .row, .query-grid { grid-template-columns: 1fr; } main { padding: 18px; } }
      </style>
    </head>
    <body>
      <main>
        <h1>Mira OSINT</h1>
        <section id="error" class="error"></section>
        <section>
          <h2>Ingest</h2>
          <div class="grid">
            <div>
              <label for="type">Type</label>
              <select id="type">
                <option value="auto">Auto</option>
                <option value="username">Username</option>
                <option value="email">Email</option>
                <option value="domain">Domain</option>
                <option value="image">Image path</option>
              </select>
            </div>
            <div>
              <label for="value">Value</label>
              <input id="value" placeholder="username, domain, email, or local image path" />
            </div>
            <button id="ingest">Run ingest</button>
            <button id="ingest-async" class="secondary">Queue ingest</button>
          </div>
          <p class="muted" id="ingest-status"></p>
        </section>

        <div class="two-col">
          <section>
            <h2>Profile Lookup</h2>
            <div class="row">
              <div>
                <label for="profile-id">Profile ID</label>
                <input id="profile-id" placeholder="Paste a profile_id or use latest ingest result" />
              </div>
              <button id="load-profile" class="secondary">Load profile</button>
            </div>
          </section>

          <section>
            <h2>Job Status</h2>
            <div class="row">
              <div>
                <label for="job-id">Job ID</label>
                <input id="job-id" placeholder="Paste a queued ingest job_id" />
              </div>
              <button id="load-job" class="secondary">Load job</button>
            </div>
          </section>
        </div>

        <div class="two-col">
          <section>
            <h2>Graph Query</h2>
            <div class="query-grid">
              <div>
                <label for="query-profile-id">Profile ID</label>
                <input id="query-profile-id" placeholder="Optional profile_id" />
              </div>
              <div>
                <label for="query-entity-value">Entity Value</label>
                <input id="query-entity-value" placeholder="Optional entity value" />
              </div>
            </div>
            <p><button id="run-query" class="tertiary">Run graph query</button></p>
          </section>

          <section>
            <h2>Vector Search</h2>
            <div class="query-grid">
              <div>
                <label for="search-query">Search Text</label>
                <input id="search-query" placeholder="Find similar profiles" />
              </div>
              <div>
                <label for="search-limit">Limit</label>
                <input id="search-limit" type="number" min="1" max="25" value="5" />
              </div>
            </div>
            <p><button id="run-search" class="tertiary">Run vector search</button></p>
          </section>
        </div>

        <section>
          <h2>Result</h2>
          <textarea id="output" class="result" readonly>{}</textarea>
        </section>
      </main>
      <script>
        const output = document.getElementById('output');
        const status = document.getElementById('ingest-status');
        const error = document.getElementById('error');
        const show = (data) => { output.value = JSON.stringify(data, null, 2); };
        const clearError = () => {
          error.style.display = 'none';
          error.textContent = '';
        };
        const showError = (message) => {
          error.textContent = message || 'Request failed.';
          error.style.display = 'block';
        };
        const requestJson = async (url, options = {}) => {
          clearError();
          const response = await fetch(url, options);
          let data = null;
          try {
            data = await response.json();
          } catch {
            data = { detail: await response.text() };
          }
          if (!response.ok) {
            const detail = data && (data.detail || data.error || data.message);
            showError(typeof detail === 'string' ? detail : `HTTP ${response.status}`);
            show(data);
            throw new Error(typeof detail === 'string' ? detail : `HTTP ${response.status}`);
          }
          show(data);
          return data;
        };
        const ingestPayload = () => ({
          type: document.getElementById('type').value,
          value: document.getElementById('value').value,
          source_label: 'ui'
        });
        document.getElementById('ingest').addEventListener('click', async () => {
          try {
            status.textContent = 'Running ingest...';
            const data = await requestJson('/api/osint/ingest', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(ingestPayload())
            });
            if (data.profile_id) document.getElementById('profile-id').value = data.profile_id;
            status.textContent = 'Ingest complete.';
          } catch {
            status.textContent = 'Ingest failed.';
          }
        });
        document.getElementById('ingest-async').addEventListener('click', async () => {
          try {
            status.textContent = 'Queueing ingest...';
            const data = await requestJson('/api/osint/ingest/async', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(ingestPayload())
            });
            if (data.job_id) document.getElementById('job-id').value = data.job_id;
            status.textContent = 'Ingest queued.';
          } catch {
            status.textContent = 'Queue failed.';
          }
        });
        document.getElementById('load-profile').addEventListener('click', async () => {
          const profileId = document.getElementById('profile-id').value;
          await requestJson(`/api/osint/profile/${encodeURIComponent(profileId)}`);
        });
        document.getElementById('load-job').addEventListener('click', async () => {
          const jobId = document.getElementById('job-id').value;
          const data = await requestJson(`/api/osint/jobs/${encodeURIComponent(jobId)}`);
          if (data.result && data.result.profile_id) document.getElementById('profile-id').value = data.result.profile_id;
        });
        document.getElementById('run-query').addEventListener('click', async () => {
          const payload = {};
          const profileId = document.getElementById('query-profile-id').value.trim();
          const entityValue = document.getElementById('query-entity-value').value.trim();
          if (profileId) payload.profile_id = profileId;
          if (entityValue) payload.entity_value = entityValue;
          await requestJson('/api/osint/query', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          });
        });
        document.getElementById('run-search').addEventListener('click', async () => {
          await requestJson('/api/osint/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              query: document.getElementById('search-query').value,
              limit: Number(document.getElementById('search-limit').value || 5)
            })
          });
        });
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
