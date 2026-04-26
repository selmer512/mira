from typing import List
from app.collectors.base import BaseCollector
from app.models.osint import Entity, SourceRecord

class DomainCollector(BaseCollector):
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        domain = value.strip().lower().removeprefix("http://").removeprefix("https://").split("/")[0]
        source = SourceRecord(name=source_label, method="manual_public_input")
        return [
            Entity(entity_type="domain", value=domain, attributes={}, sources=[source]),
            Entity(entity_type="website", value=f"https://{domain}", attributes={"derived_from": "domain"}, sources=[source]),
        ]
