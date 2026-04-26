from abc import ABC, abstractmethod
from typing import List
from app.models.osint import Entity

class BaseCollector(ABC):
    @abstractmethod
    async def collect(self, value: str, source_label: str = "manual") -> List[Entity]:
        raise NotImplementedError
