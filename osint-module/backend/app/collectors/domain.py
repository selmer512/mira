import asyncio
from urllib.parse import urlparse
from typing import List

from app.collectors.base import BaseCollector
from app.models.osint import Entity, SourceRecord


class DomainCollector(BaseCollector):
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        parsed = urlparse(value if "://" in value else f"https://{value}")
        domain = (parsed.hostname or "").strip().lower().rstrip(".")
        if not domain:
            raise ValueError("Invalid domain input")

        source = SourceRecord(name=source_label, method="manual_public_input")

        dns_records = await self._resolve_domain(domain)
        return [
            Entity(entity_type="domain", value=domain, attributes={"dns_records": dns_records}, sources=[source]),
            Entity(
                entity_type="website",
                value=f"https://{domain}",
                attributes={"derived_from": "domain", "hostname": domain},
                sources=[source],
            ),
        ]

    async def _resolve_domain(self, domain: str) -> List[str]:
        loop = asyncio.get_running_loop()
        try:
            addr_info = await loop.getaddrinfo(domain, None, proto=0)
        except Exception:
            return []

        ips = {item[4][0] for item in addr_info if item and item[4]}
        return sorted(ips)
