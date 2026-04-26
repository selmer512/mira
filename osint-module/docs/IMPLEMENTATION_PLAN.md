# Implementation Plan

## Phase 1 – Make the API Run
1. Start Docker Compose.
2. Verify `/health`.
3. Verify `/api/osint/ingest` for username, email, domain, image.
4. Confirm Neo4j receives Profile and Entity nodes.
5. Confirm Qdrant collection `osint_profiles` is created.

## Phase 2 – Add Real Collectors
Implement collectors as isolated modules.

Recommended initial collectors:
- Username public profile checker
- Domain DNS/WHOIS adapter
- Image EXIF parser for user-uploaded images

Each collector must return normalized `Entity` objects.

## Phase 3 – Event Pipeline
Replace `workers/events.py` placeholder with `aiokafka`.

Topics:
- `osint.raw`
- `osint.enriched`
- `osint.graph`
- `osint.profile`

## Phase 4 – Profile UI
Add frontend views:
- Search box
- Entity list
- Confidence score
- Graph visualization
- Source provenance panel

## Phase 5 – Mira Integration
Connect to Mira memory:
- Store structured facts in graph memory.
- Store text artifacts in vector memory.
- Link profile IDs to Mira long-term memory IDs.

## Done Criteria
- Can submit a username/email/domain.
- System returns a profile ID.
- Profile entities are persisted in Neo4j.
- Profile payload is embedded/stored in Qdrant.
- n8n can trigger ingestion.
