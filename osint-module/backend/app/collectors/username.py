import re
from typing import List

from app.collectors.base import BaseCollector
from app.models.osint import Entity, SourceRecord

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_\.\-]{2,32}$")


class UsernameCollector(BaseCollector):
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        username = value.strip().lstrip("@")
        if not _USERNAME_RE.match(username):
            raise ValueError("Invalid username format")

        normalized = username.lower()
        source = SourceRecord(name=source_label, method="manual_public_input")
        discovered_profiles = {
            "github": f"https://github.com/{normalized}",
            "x": f"https://x.com/{normalized}",
            "reddit": f"https://www.reddit.com/user/{normalized}",
        }

        return [
            Entity(
                entity_type="username",
                value=username,
                attributes={"normalized": normalized, "platform_candidates": discovered_profiles},
                sources=[source],
            )
        ]
