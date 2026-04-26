from typing import List
from app.collectors.base import BaseCollector
from app.models.osint import Entity, SourceRecord

class EmailCollector(BaseCollector):
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        email = value.strip().lower()
        domain = email.split("@")[-1] if "@" in email else ""
        source = SourceRecord(name=source_label, method="manual_public_input")

        entities = [
            Entity(entity_type="email", value=email, attributes={}, sources=[source])
        ]

        if domain:
            entities.append(
                Entity(entity_type="domain", value=domain, attributes={"derived_from": "email"}, sources=[source])
            )

        return entities
