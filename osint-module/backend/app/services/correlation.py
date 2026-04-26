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
