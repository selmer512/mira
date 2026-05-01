import hashlib
from typing import List
from app.models.osint import Entity, CorrelationResult

WEIGHTS = {
    "username": 0.40,
    "email": 0.40,
    "image": 0.20,
    "domain": 0.25,
    "website": 0.20,
}

def deduplicate_entities(entities: List[Entity]) -> List[Entity]:
    deduped: dict[tuple[str, str], Entity] = {}
    for entity in entities:
        key = (entity.entity_type.lower(), entity.value.strip().lower())
        existing = deduped.get(key)
        if existing is None:
            entity.entity_type = entity.entity_type.lower()
            entity.value = entity.value.strip()
            deduped[key] = entity
            continue

        existing.attributes = {**existing.attributes, **entity.attributes}
        seen_sources = {(source.name, source.url, source.method) for source in existing.sources}
        for source in entity.sources:
            source_key = (source.name, source.url, source.method)
            if source_key not in seen_sources:
                existing.sources.append(source)
                seen_sources.add(source_key)

    return list(deduped.values())

def stable_profile_id(entities: List[Entity]) -> str:
    seed = "|".join(sorted([f"{e.entity_type}:{e.value.lower()}" for e in entities]))
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]

def confidence_for_entities(entities: List[Entity]) -> float:
    score = 0.0
    seen = set()
    for entity in entities:
        if entity.entity_type not in seen:
            score += WEIGHTS.get(entity.entity_type, 0.05)
            seen.add(entity.entity_type)
    return min(round(score, 2), 0.99)

def correlate_entities(entities: List[Entity]) -> CorrelationResult:
    entities = deduplicate_entities(entities)
    profile_id = stable_profile_id(entities)
    confidence = confidence_for_entities(entities)

    relationships = []
    for entity in entities:
        relationships.append({
            "from": profile_id,
            "to": entity.value,
            "type": f"HAS_{entity.entity_type.upper()}",
            "confidence": confidence,
        })

    return CorrelationResult(
        profile_id=profile_id,
        confidence=confidence,
        entities=entities,
        relationships=relationships,
    )
