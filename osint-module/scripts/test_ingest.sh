#!/usr/bin/env bash
set -euo pipefail

curl -s -X POST http://localhost:8000/api/osint/ingest \
  -H "Content-Type: application/json" \
  -d '{"type":"username","value":"example_user"}' | jq

curl -s -X POST http://localhost:8000/api/osint/ingest \
  -H "Content-Type: application/json" \
  -d '{"type":"email","value":"person@example.com"}' | jq

curl -s -X POST http://localhost:8000/api/osint/ingest \
  -H "Content-Type: application/json" \
  -d '{"type":"domain","value":"example.com"}' | jq
