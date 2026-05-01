from app.models.osint import Entity
from app.services.correlation import correlate_entities, deduplicate_entities


def test_deduplicate_entities_merges_attributes_and_sources():
    first = Entity(entity_type="username", value="Alice", attributes={"normalized": "alice"})
    second = Entity(entity_type="username", value="alice", attributes={"platform": "github"})

    deduped = deduplicate_entities([first, second])

    assert len(deduped) == 1
    assert deduped[0].value == "Alice"
    assert deduped[0].attributes == {"normalized": "alice", "platform": "github"}


def test_correlate_entities_uses_deduplicated_entities_for_profile():
    result = correlate_entities(
        [
            Entity(entity_type="domain", value="Example.com"),
            Entity(entity_type="domain", value="example.com"),
        ]
    )

    assert len(result.entities) == 1
    assert len(result.relationships) == 1
