# Mira OSINT Module – Coding Agent Handoff

This package provides a starter implementation for adding a public-data OSINT module into Mira.

## Scope

The module is designed to collect, normalize, correlate, and store public information from user-provided inputs such as:

- Username
- Email
- Domain
- Image metadata

This scaffold intentionally avoids credential attacks, login bypassing, private data collection, dark web scraping, breach-database scraping, or invasive biometric identification.

## Stack

- FastAPI backend
- Neo4j graph storage
- Qdrant vector storage
- Redpanda/Kafka-style event pipeline
- n8n webhook workflow starter
- Docker Compose for local development

## Architecture

```text
Client / n8n
   |
   v
FastAPI /api/osint/ingest
   |
   v
Input normalization
   |
   v
Collector dispatch
   |
   v
Correlation engine
   |
   v
Neo4j graph + Qdrant vector storage
   |
   v
Profile API
```

## Quick Start

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Or with Docker:

```bash
docker compose up --build
```

## Main API Endpoints

```http
GET  /api/osint/ui
POST /api/osint/ingest
POST /api/osint/ingest/async
GET  /api/osint/jobs/{job_id}
GET  /api/osint/profile/{profile_id}
POST /api/osint/search
POST /api/osint/query
POST /api/osint/enrich/{entity_id}
GET  /health
```

## Example Ingest

```bash
curl -X POST http://localhost:8000/api/osint/ingest \
  -H "Content-Type: application/json" \
  -d '{"type":"username","value":"example_user"}'
```

## Files of Interest

- `backend/app/main.py` - FastAPI app entrypoint
- `backend/app/api/osint.py` - API routes
- `backend/app/core/config.py` - environment settings
- `backend/app/collectors/` - modular collector stubs
- `backend/app/services/correlation.py` - confidence scoring
- `backend/app/services/graph_store.py` - Neo4j adapter
- `backend/app/services/vector_store.py` - Qdrant adapter
- `backend/app/workers/events.py` - Redpanda/Kafka event placeholders
- `n8n/mira_osint_ingest_workflow.json` - starter workflow
- `docs/IMPLEMENTATION_PLAN.md` - build order
- `docs/DATA_MODEL.md` - graph/vector schema
- `docs/SECURITY_BOUNDARIES.md` - guardrails for safe implementation
