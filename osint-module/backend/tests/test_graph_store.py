import pytest

from app.models.osint import CorrelationResult, Entity, SourceRecord
from app.services.graph_store import GraphStore


class FakeTx:
    def __init__(self):
        self.queries = []

    async def run(self, query, **params):
        self.queries.append((query, params))


@pytest.mark.asyncio
async def test_upsert_profile_normalizes_nested_attributes_into_nodes():
    tx = FakeTx()
    correlation = CorrelationResult(
        profile_id="profile-1",
        confidence=0.7,
        entities=[
            Entity(
                entity_type="domain",
                value="example.com",
                attributes={"dns_records": ["203.0.113.10"]},
                sources=[SourceRecord(name="manual", method="manual_public_input")],
            ),
            Entity(
                entity_type="username",
                value="alice",
                attributes={"platform_candidates": {"github": "https://github.com/alice"}},
            ),
            Entity(
                entity_type="image",
                value="/tmp/photo.jpg",
                attributes={
                    "phash": "abc123",
                    "size": {"width": 640, "height": 480},
                    "exif": {"271": "Camera"},
                },
            ),
        ],
    )

    await GraphStore._upsert_profile_tx(tx, correlation)
    cypher = "\n".join(query for query, _ in tx.queries)

    assert "MERGE (ip:IpAddress" in cypher
    assert "MERGE (candidate:Website" in cypher
    assert "MERGE (hash:ImageHash" in cypher
    assert "MERGE (dim:ImageDimension" in cypher
    assert "MERGE (tag:ExifTag" in cypher
    assert "MERGE (s:Source" in cypher
    assert "e.attributes" not in cypher
