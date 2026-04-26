from typing import List
from app.collectors.base import BaseCollector
from app.models.osint import Entity, SourceRecord

class UsernameCollector(BaseCollector):
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        username = value.strip().lstrip("@")
        source = SourceRecord(name=source_label, method="manual_public_input")
        return [
            Entity(
                entity_type="username",
                value=username,
                attributes={"normalized": username.lower()},
                sources=[source],
            )
        ]
